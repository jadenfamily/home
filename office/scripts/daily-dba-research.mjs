/* ==================================================================
   📰 금융권(증권사) DBA 데일리 리서치 — jadenfamily/home · office/scripts/daily-dba-research.mjs

   데이터 저장소(jadenfamily/kids-dashboard-data)의 GitHub Actions
   (.github/workflows/daily-dba-research.yml)가 그 저장소 루트에서
   bash _home/office/scripts/run-dba-research.sh 로 이 파일을 실행한다.
   (작업 폴더 = 데이터 저장소, 본체 = _home 으로 받은 이 공개 저장소)
   외부 npm 패키지 없이 Node 20 내장 fetch · node:crypto(WebCrypto)만 쓴다.

   하는 일
   1) ai-office/office-state.json · config/ai.json 을 OFFICE_PASS 로 열어(화면과 같은
      PBKDF2-SHA256 150,000회 + AES-GCM) 사용자의 외부 AI 키(OpenRouter·Groq·Gemini)를 읽는다.
      AI 호출 순서는 OpenRouter → Groq → Gemini(최후 폴백) 이다.
   2) 공개 피드(RSS/Atom·HTML·공개 API)에서 최근 MySQL·Oracle·PostgreSQL·클라우드 DB·
      대용량 분석 DB(ClickHouse·StarRocks·Apache Doris·DuckDB)·MySQL 샤딩(Vitess)·
      보안 CVE·온프레미스 LLM 소식을 모은다. 피드 하나가 느리거나 실패해도 나머지로 계속 간다.
   3) 모은 기사만 근거로 리서치팀 프롬프트를 만들어 요약한다. 모델은 기사 번호(ref)만 고르고
      URL·출처는 이 스크립트가 채우므로, 목록에 없는 링크가 결과에 섞이지 않는다.
   4) ai-office/daily-dba-brief/YYYY-MM-DD.json (Asia/Seoul 날짜) 과 latest.json 에 저장한다.
      파일 저장(커밋)은 run-dba-research.sh 가 한다.
   5) ai-office/office-state.json 의 work[] 에 리서치팀 완료 기록 1건을 남긴다(같은 기록을
      매일 갱신하므로 사무실 기록이 계속 불어나지 않는다). GitHub Contents API 로 최신 sha 를
      다시 읽어 병합하고, 409 충돌이면 재시도한다.
   6) 최근 7일 브리핑에 이미 실린 기사(URL·제목)는 수집 단계에서 빼서 같은 기사를 다시
      보고하지 않는다.
   7) 매주 월요일(Asia/Seoul)에는 지난 7일치를 모아 주간 요약(weekly-YYYY-MM-DD.json ·
      latest-weekly.json)을 함께 만들고 사무실 기록(kind=weekly-brief)도 1건 갱신한다.

   실행 예 (작업 폴더는 데이터 저장소 루트)
     node _home/office/scripts/daily-dba-research.mjs            # 실제 실행(수집→요약→저장→사무실 기록)
     node _home/office/scripts/daily-dba-research.mjs --dry-run  # 수집·프롬프트까지만(AI 호출·저장 없음)
     node _home/office/scripts/daily-dba-research.mjs --no-ai --dump out.json   # 수집 결과만 파일로
     node _home/office/scripts/daily-dba-research.mjs --no-office     # 사무실 기록은 건너뜀
     node _home/office/scripts/daily-dba-research.mjs --weekly        # 요일과 상관없이 주간 요약까지
     node _home/office/scripts/daily-dba-research.mjs --local    # GitHub API 대신 현재 폴더 파일 사용
   ================================================================== */
import { webcrypto as WC } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* ---------- 실행 인자 ---------- */
const ARGS = process.argv.slice(2);
function flag(name) { return ARGS.indexOf('--' + name) >= 0; }
function opt(name, def) {
  const pre = '--' + name + '=';
  for (let i = 0; i < ARGS.length; i++) {
    if (ARGS[i].indexOf(pre) === 0) return ARGS[i].slice(pre.length);
    if (ARGS[i] === '--' + name && ARGS[i + 1] && ARGS[i + 1].indexOf('--') !== 0) return ARGS[i + 1];
  }
  return def;
}
const DRY = flag('dry-run');
const NO_AI = flag('no-ai');
const NO_OFFICE = flag('no-office');
const LOCAL = flag('local');
const DUMP = opt('dump', '');
const FORCE_DATE = String(opt('date', '')).trim();
const MAX_ITEMS = Math.max(10, Math.min(120, Number(opt('max-items', 64)) || 64));

/* ---------- 저장소·환경 ---------- */
const REPO_ENV = String(process.env.GITHUB_REPOSITORY || 'jadenfamily/kids-dashboard-data');
const OWNER = String(process.env.OFFICE_OWNER || REPO_ENV.split('/')[0] || 'jadenfamily');
const REPO = String(process.env.OFFICE_DATA_REPO || REPO_ENV.split('/')[1] || 'kids-dashboard-data');
const BRANCH = String(process.env.OFFICE_BRANCH || 'main');
const API = String(process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const TOKEN = String(process.env.GITHUB_TOKEN || '');
const PASS = String(process.env.OFFICE_PASS || '');
const ROOT = path.resolve(opt('root', process.cwd()));

const P_OFFICE = 'ai-office/office-state.json';
const P_AI = 'config/ai.json';
const P_OUT_DIR = 'ai-office/daily-dba-brief';

const OPENROUTER_URL = String(process.env.OFFICE_OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions');
const GROQ_URL = String(process.env.OFFICE_GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions');
const GEMINI_BASE = String(process.env.OFFICE_GEMINI_BASE || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');

/* AI 응답 하나를 기다리는 시간(기본 120초). 넘으면 다음 모델로 넘어간다. */
const AI_TIMEOUT_MS = (function () {
  const v = Number(process.env.DBA_AI_TIMEOUT_MS);
  return (v >= 20000 && v <= 240000) ? v : 120000;
})();
const FEED_TIMEOUT_MS = (function () {
  const v = Number(process.env.DBA_FEED_TIMEOUT_MS);
  return (v >= 3000 && v <= 30000) ? v : 12000;
})();
const UA = 'Mozilla/5.0 (compatible; jadenfamily-dba-research/1.0; +https://github.com/jadenfamily/kids-dashboard-data)';

/* ---------- 잡동사니 ---------- */
function log() { console.log('[dba-research]', Array.prototype.slice.call(arguments).join(' ')); }
function warn() { console.log('[dba-research] ⚠', Array.prototype.slice.call(arguments).join(' ')); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function nowIso() { return new Date().toISOString(); }

/* KST 날짜/시각 (워크플로 컨테이너는 UTC 로 돌기 때문에 직접 계산한다) */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstParts(d) {
  const t = new Date((d ? d.getTime() : Date.now()) + KST_OFFSET_MS);
  return {
    date: t.toISOString().slice(0, 10),
    time: t.toISOString().slice(11, 19),
    weekday: ['일', '월', '화', '수', '목', '금', '토'][t.getUTCDay()]
  };
}
const TODAY = FORCE_DATE && /^\d{4}-\d{2}-\d{2}$/.test(FORCE_DATE) ? FORCE_DATE : kstParts().date;
const NOW_LABEL = kstParts().date + ' ' + kstParts().time + ' KST';

/* ==================================================================
   공통 fetch (타임아웃·실패해도 예외를 던지지 않음)
   ================================================================== */
async function fetchText(url, o) {
  const oo = o || {};
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, oo.timeout || FEED_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: oo.method || 'GET',
      headers: Object.assign({ 'User-Agent': UA, 'Accept': oo.accept || 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5' }, oo.headers || {}),
      body: oo.body,
      signal: ac.signal,
      redirect: 'follow'
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text, ms: Date.now() - t0, url: res.url || url };
  } catch (e) {
    const to = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
    return { ok: false, status: 0, error: to ? ('응답 없음(' + Math.round((oo.timeout || FEED_TIMEOUT_MS) / 1000) + '초 초과)') : String((e && e.message) || e), ms: Date.now() - t0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

/* ==================================================================
   암호 — 화면(familyEncrypt/familyDecrypt)·worker.mjs 와 같은 규격
   ================================================================== */
const CT_ITER = 150000;
const TE = new TextEncoder();
const TD = new TextDecoder('utf-8');
function b64enc(buf) { return Buffer.from(buf).toString('base64'); }
function b64dec(txt) { return new Uint8Array(Buffer.from(String(txt || '').replace(/\s+/g, ''), 'base64')); }
async function familyKey(salt, iter) {
  const base = await WC.subtle.importKey('raw', TE.encode(PASS), { name: 'PBKDF2' }, false, ['deriveKey']);
  return WC.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: Math.min(1000000, Math.max(1, Number(iter) || 1)), hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function familyDecrypt(env) {
  if (!env || !env.iv || !env.ct) return null;
  const k = await familyKey(env.salt ? b64dec(env.salt) : null, env.iter || 1);
  const pt = await WC.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(env.iv) }, k, b64dec(env.ct));
  return JSON.parse(TD.decode(new Uint8Array(pt)));
}
async function familyEncrypt(obj) {
  const salt = WC.getRandomValues(new Uint8Array(16));
  const iv = WC.getRandomValues(new Uint8Array(12));
  const k = await familyKey(salt, CT_ITER);
  const ct = await WC.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, TE.encode(JSON.stringify(obj)));
  return { version: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: CT_ITER, salt: b64enc(salt), iv: b64enc(iv), ct: b64enc(ct), updatedAt: nowIso() };
}

/* ==================================================================
   파일 읽기/쓰기 — GitHub Actions 에서는 Contents API, 로컬 테스트는 --local
   ================================================================== */
function encPath(p) { return String(p || '').split('/').map(encodeURIComponent).join('/'); }
function repoUrl() { return API + '/repos/' + encodeURIComponent(OWNER) + '/' + encodeURIComponent(REPO); }
function ghHeaders() {
  const h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jadenfamily-dba-research' };
  if (TOKEN) h['Authorization'] = 'Bearer ' + TOKEN;
  return h;
}
async function ghRead(p) {
  if (LOCAL || !TOKEN) {
    const abs = path.join(ROOT, p);
    if (!fs.existsSync(abs)) return { ok: true, missing: true };
    return { ok: true, text: fs.readFileSync(abs, 'utf8'), sha: null, local: true };
  }
  const url = repoUrl() + '/contents/' + encPath(p) + '?ref=' + encodeURIComponent(BRANCH) + '&_=' + Date.now();
  const got = await fetchText(url, { accept: 'application/vnd.github+json', headers: ghHeaders(), timeout: 20000 });
  if (!got.status) return { ok: false, status: 0, error: got.error || '네트워크 오류' };
  if (got.status === 404) return { ok: true, missing: true };
  if (!got.ok) return { ok: false, status: got.status, error: 'HTTP ' + got.status };
  let j = null;
  try { j = JSON.parse(got.text); } catch (e) { j = null; }
  if (!j) return { ok: false, status: got.status, error: '응답을 읽지 못했어요' };
  let text = '';
  if (j.content) text = Buffer.from(String(j.content).replace(/\s+/g, ''), 'base64').toString('utf8');
  else if (j.download_url) {
    const raw = await fetchText(j.download_url, { accept: '*/*', timeout: 20000 });
    if (!raw.ok) return { ok: false, status: raw.status, error: '내용을 받지 못했어요' };
    text = raw.text;
  }
  return { ok: true, text: text, sha: j.sha, size: j.size };
}
async function ghWrite(p, text, sha, message) {
  if (LOCAL || !TOKEN) {
    const abs = path.join(ROOT, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    return { ok: true, local: true };
  }
  const body = { message: message, content: Buffer.from(text, 'utf8').toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const got = await fetchText(repoUrl() + '/contents/' + encPath(p), {
    method: 'PUT', accept: 'application/vnd.github+json',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
    body: JSON.stringify(body), timeout: 25000
  });
  if (got.ok) return { ok: true, status: got.status };
  let msg = 'HTTP ' + got.status;
  try { const j = JSON.parse(got.text); if (j && j.message) msg = j.message; } catch (e) { /* 무시 */ }
  return { ok: false, status: got.status, error: msg };
}
function writeLocal(rel, text) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
}

/* ==================================================================
   AI 키 읽기 (config/ai.json 우선, 없으면 office-state.json 안의 keys)
   ================================================================== */
const PROVIDER_IDS = ['openrouter', 'groq', 'gemini'];
function normKeys(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < arr.length; i++) {
    const k = String(arr[i] == null ? '' : arr[i]).trim();
    if (k && out.indexOf(k) < 0) out.push(k);
  }
  return out;
}
function keysFromObject(obj) {
  const keys = { openrouter: [], groq: [], gemini: [] };
  if (!obj || typeof obj !== 'object') return keys;
  for (const pid of PROVIDER_IDS) {
    let list = normKeys(obj[pid + 'Keys']);
    if (!list.length) {
      const single = String((pid === 'gemini' ? (obj.key || obj.gemini) : obj[pid]) || '').trim();
      if (single) list = [single];
    }
    /* 화면 설정은 office-state.json 의 ai 안에 넣기도 한다 */
    if (!list.length && obj.ai && obj.ai.keys) list = normKeys(obj.ai.keys[pid]);
    keys[pid] = list;
  }
  return keys;
}
async function loadKeys() {
  const keys = { openrouter: [], groq: [], gemini: [] };
  const sources = [];
  for (const p of [P_AI, P_OFFICE]) {
    const r = await ghRead(p);
    if (!r.ok) { warn(p + ' 읽기 실패 · ' + (r.error || '')); continue; }
    if (r.missing) continue;
    let env = null;
    try { env = JSON.parse(r.text); } catch (e) { env = null; }
    let obj = null;
    if (env && env.ct && env.iv) {
      try { obj = await familyDecrypt(env); } catch (e) {
        warn(p + ' 을(를) 열지 못했어요 (OFFICE_PASS 확인) · ' + String((e && e.message) || e).slice(0, 60));
        continue;
      }
    } else {
      obj = env;   /* 평문으로 저장된 경우도 받아 준다 */
    }
    const got = keysFromObject(obj);
    for (const pid of PROVIDER_IDS) {
      if (!keys[pid].length && got[pid].length) keys[pid] = got[pid];
    }
    sources.push(p);
  }
  return { keys, sources };
}

/* ==================================================================
   피드 수집 도우미 (XML·HTML·텍스트)
   ================================================================== */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8217': '’', '#8216': '‘', '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—', '#8230': '…' };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
    .replace(/&#(\d+);/g, function (_, d) { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ''; } })
    .replace(/&([a-z]+|#\d+);/gi, function (m, n) { return ENT[n] !== undefined ? ENT[n] : m; });
}
function stripCdata(s) {
  let t = String(s || '');
  const m = t.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (m) t = m[1];
  return t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
function stripHtml(s) {
  /* 엔티티를 풀면 &lt;p&gt; 같은 이스케이프된 태그가 진짜 태그가 되므로, 풀고 → 지우기를 두 번 돌린다. */
  let t = String(s || '');
  for (let pass = 0; pass < 2; pass++) {
    t = decodeEntities(t)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<\/?[a-z][^>]*>/gi, ' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}
function trunc(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function xmlBlocks(xml) {
  const out = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(m[2]);
  return out;
}
function xmlTag(block, names) {
  for (let i = 0; i < names.length; i++) {
    const re = new RegExp('<' + names[i] + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + names[i] + '>', 'i');
    const m = String(block || '').match(re);
    if (m) return stripCdata(m[1]).trim();
  }
  return '';
}
function xmlLink(block) {
  /* Atom: <link rel="alternate" href="..."/> / RSS: <link>...</link> / guid */
  const alt = String(block || '').match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)
    || String(block || '').match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i);
  if (alt) return decodeEntities(alt[1]).trim();
  const plain = xmlTag(block, ['link']);
  if (plain) return decodeEntities(plain).trim();
  const href = String(block || '').match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  if (href) return decodeEntities(href[1]).trim();
  return decodeEntities(xmlTag(block, ['guid', 'id'])).trim();
}
function parseFeedDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  const m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return Date.parse(m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0') + 'T00:00:00Z');
  return 0;
}
function isoOf(ms) { return ms ? new Date(ms).toISOString() : ''; }

/* ==================================================================
   피드 정의 — 하나가 실패해도 다음 피드로 계속 간다
   ================================================================== */
const FEEDS = [
  /* MySQL·Oracle 공식 블로그는 Akamai 가 데이터센터 IP 를 403 으로 막는 경우가 있어,
     GitHub Actions(러너 IP)에서 열리면 쓰고 막히면 조용히 건너뛴다. */
  { id: 'mysql-blog', name: 'MySQL 공식 블로그', url: 'https://dev.mysql.com/blog-archive/feed/', kind: 'rss', days: 30, limit: 10, tag: 'db' },
  { id: 'oracle-blog', name: 'Oracle Database 블로그', url: 'https://blogs.oracle.com/database/rss', kind: 'rss', days: 30, limit: 10, tag: 'db' },
  { id: 'oracle-base', name: 'ORACLE-BASE (Tim Hall)', url: 'https://oracle-base.com/blog/feed/', kind: 'rss', days: 45, limit: 6, tag: 'db' },
  { id: 'pg-news', name: 'PostgreSQL 공식 뉴스', url: 'https://www.postgresql.org/news.rss', kind: 'rss', days: 60, limit: 8, tag: 'db' },
  { id: 'pg-planet', name: 'Planet PostgreSQL', url: 'https://planet.postgresql.org/rss20.xml', kind: 'rss', days: 12, limit: 8, tag: 'db' },
  { id: 'aws-db', name: 'AWS Database 블로그', url: 'https://aws.amazon.com/blogs/database/feed/', kind: 'rss', days: 14, limit: 10, tag: 'cloud' },
  { id: 'percona', name: 'Percona 블로그', url: 'https://www.percona.com/blog/feed/', kind: 'rss', days: 14, limit: 10, tag: 'db' },
  /* 대용량 분석(OLAP) DB·MySQL 샤딩 — 공식 블로그와 GitHub Releases.
     ClickHouse·Apache Doris·StarRocks·Vitess 블로그는 RSS 가 없거나(2026-11 확인) 오래 멈춰 있어
     릴리스 피드를 쓴다. StarRocks 블로그 RSS(starrocks.io/blog/rss.xml)는 2026-04 이후 새 글이 없어 넣지 않았다. */
  { id: 'clickhouse-blog', name: 'ClickHouse 블로그', url: 'https://clickhouse.com/rss.xml', kind: 'rss', days: 14, limit: 6, tag: 'analytics', brand: 'ClickHouse' },
  { id: 'clickhouse-rel', name: 'ClickHouse 릴리스', url: 'https://github.com/ClickHouse/ClickHouse/releases.atom', kind: 'rss', days: 21, limit: 3, tag: 'analytics', brand: 'ClickHouse' },
  { id: 'starrocks-rel', name: 'StarRocks 릴리스', url: 'https://github.com/StarRocks/starrocks/releases.atom', kind: 'rss', days: 30, limit: 2, tag: 'analytics', brand: 'StarRocks' },
  { id: 'doris-rel', name: 'Apache Doris 릴리스', url: 'https://github.com/apache/doris/releases.atom', kind: 'rss', days: 45, limit: 2, tag: 'analytics', brand: 'Apache Doris' },
  { id: 'duckdb-news', name: 'DuckDB 블로그·릴리스', url: 'https://duckdb.org/feed.xml', kind: 'rss', days: 30, limit: 5, tag: 'analytics', brand: 'DuckDB' },
  { id: 'vitess-rel', name: 'Vitess 릴리스', url: 'https://github.com/vitessio/vitess/releases.atom', kind: 'rss', days: 45, limit: 2, tag: 'analytics', brand: 'Vitess' },
  { id: 'theregister', name: 'The Register', url: 'https://www.theregister.com/headlines.atom', kind: 'rss', days: 8, limit: 6, tag: 'tech' },
  { id: 'cisa-news', name: 'CISA 소식', url: 'https://www.cisa.gov/news.xml', kind: 'rss', days: 30, limit: 5, tag: 'security' },
  /* 한국 보안 소식 — 금융권 사고·규제·취약점 */
  { id: 'dailysecu', name: '데일리시큐', url: 'https://www.dailysecu.com/rss/allArticle.xml', kind: 'rss', days: 7, limit: 6, tag: 'security' }
];

/* DB·금융 IT 와 상관없는 일반 기사를 걸러 내는 기준 */
const RELEVANT_RE = /mysql|mariadb|innodb|oracle|postgres|postgre|aurora|exadata|tibero|cubrid|altibase|\bdbms\b|database|\bdba\b|\bsql\b|백업|복구|장애|패치|취약점|cve-|ransomware|랜섬|llm|온프레미스|on-?prem|private llm|감사|망분리|규제|개인정보|금융|은행|증권|보험|카드|전자금융|clickhouse|starrocks|apache doris|\bdoris\b|duckdb|vitess|\bolap\b|분석 db|샤딩|sharding/i;
const ORACLE_DB_RE = /oracle[\s\S]{0,60}(database|db\b|mysql|patch|exadata|grid|rac|linux|cloud infrastructure|cve)|(database|db\b|mysql|patch|exadata|rac)[\s\S]{0,60}oracle/i;
const AI_RE = /\bllm\b|large language model|온프레미스|on-?prem|private (ai|llm)|local (ai|llm)|gpt|claude|gemini|llama|qwen|rag\b|vector database|text-to-sql|aiops|ai ops|copilot|에이전트|파인튜닝|fine-?tun/i;

function relevantItem(it, tag) {
  const text = (it.title || '') + ' ' + (it.snippet || '');
  if (!RELEVANT_RE.test(text) && !(tag === 'ai' && AI_RE.test(text))) return false;
  if (/oracle/i.test(text) && !ORACLE_DB_RE.test(text)) return false;
  return true;
}

async function collectRss(feed) {
  const got = await fetchText(feed.url);
  if (!got.ok) return { items: [], error: got.error || ('HTTP ' + got.status) };
  const blocks = xmlBlocks(got.text);
  if (!blocks.length) return { items: [], error: '기사 항목이 없어요 (' + (got.text || '').length + 'B)' };
  const since = Date.now() - feed.days * 86400000;
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let title = stripHtml(xmlTag(b, ['title']));
    const url = xmlLink(b);
    if (!title || !url || !/^https?:/i.test(url)) continue;
    /* 릴리스 피드의 제목("4.1.8", "Release v26.11.3.10-stable")에는 제품명이 없어
       걸러지거나 누가 뭘 냈는지 알 수 없다. 제품명을 앞에 붙인다. */
    if (feed.brand && title.toLowerCase().indexOf(String(feed.brand).toLowerCase()) < 0) title = feed.brand + ' · ' + title;
    const ms = parseFeedDate(xmlTag(b, ['pubDate', 'published', 'updated', 'dc:date'])) || 0;
    if (ms && ms < since) continue;
    const desc = xmlTag(b, ['description', 'summary', 'content:encoded', 'content']);
    let snippet = clip(stripHtml(desc), 320);
    /* GitHub Releases atom 은 본문이 빈 경우 content 가 "No content." 로 온다. */
    if (!snippet || /^no content\.?$/i.test(snippet)) snippet = (feed.brand || feed.name) + ' 새 릴리스 · 자세한 내용은 릴리스 노트(링크) 참고';
    out.push({
      source: feed.name, feed: feed.id, title: clip(title, 160), url: url,
      published: isoOf(ms), ms: ms, snippet: snippet, ord: i    /* 피드 안 순서(최신 먼저) — 릴리스 피드의 rescue 판단에 쓴다 */
    });
  }
  return { items: out.slice(0, feed.limit), error: '' };
}

/* ---------- Hacker News (최근 48시간, Algolia 공개 API) ---------- */
/* Algolia 는 query 안의 OR 를 불리언이 아니라 구(句)로 읽어 0건이 되므로(2026-11 확인),
   제품별로 따로 질의해 URL 로 합친다. */
const HN_QUERIES = ['MySQL', 'Oracle', 'PostgreSQL', 'database', 'DBA', 'LLM', 'on-premise', 'data breach',
  'ClickHouse', 'StarRocks', 'Apache Doris', 'DuckDB', 'Vitess'];
async function collectHn() {
  const since = Math.floor((Date.now() - 48 * 3600000) / 1000);
  const stats = [];
  const out = [];
  for (const q of HN_QUERIES) {
    const url = 'https://hn.algolia.com/api/v1/search_by_date?query=' + encodeURIComponent(q)
      + '&tags=story&hitsPerPage=12&numericFilters=created_at_i>' + since;
    const got = await fetchText(url, { accept: 'application/json' });
    if (!got.ok) { stats.push(q + ':실패'); continue; }
    let j = null;
    try { j = JSON.parse(got.text); } catch (e) { j = null; }
    if (!j || !Array.isArray(j.hits)) { stats.push(q + ':형식오류'); continue; }
    let n = 0;
    for (const h of j.hits) {
      const title = clip(h.title || '', 160);
      if (!title) continue;
      const link = h.url || ('https://news.ycombinator.com/item?id=' + h.objectID);
      const points = Number(h.points) || 0;
      const it = {
        source: 'Hacker News', feed: 'hn', title: title, url: link,
        published: isoOf((Number(h.created_at_i) || 0) * 1000), ms: (Number(h.created_at_i) || 0) * 1000,
        snippet: clip('Hacker News · 추천 ' + points + ' · 댓글 ' + (Number(h.num_comments) || 0) + (h.story_text ? ' · ' + stripHtml(h.story_text) : ''), 260),
        points: points
      };
      if (!RELEVANT_RE.test(title + ' ' + (h.story_text || ''))) continue;
      if (/oracle/i.test(title) && !ORACLE_DB_RE.test(title + ' ' + (h.story_text || ''))) continue;
      if (points < 8 && !/mysql|oracle|postgres|database|\bdba\b|clickhouse|starrocks|doris|duckdb|vitess/i.test(title)) continue;
      out.push(it); n++;
    }
    stats.push(q + ':' + n);
  }
  /* 같은 기사가 여러 질의에 걸리므로 URL 로 중복 제거 */
  const seen = {};
  const uniq = [];
  for (const it of out) {
    const k = normUrl(it.url);
    if (seen[k]) { seen[k].points = Math.max(seen[k].points || 0, it.points || 0); continue; }
    seen[k] = it; uniq.push(it);
  }
  uniq.sort(function (a, b) { return (b.points || 0) - (a.points || 0); });
  return { items: uniq.slice(0, 14), error: stats.join(' / ') };
}

/* ---------- NVD CVE (CPE 로 제품을 정확히 지정) ---------- */
const NVD_CPES = [
  { cpe: 'cpe:2.3:a:oracle:mysql_server', label: 'MySQL Server' },
  { cpe: 'cpe:2.3:a:oracle:database_server', label: 'Oracle Database' },
  { cpe: 'cpe:2.3:a:postgresql:postgresql', label: 'PostgreSQL' }
];
async function collectNvd(days) {
  const back = days || 10;
  const end = new Date();
  const start = new Date(Date.now() - back * 86400000);
  const q = 'pubStartDate=' + encodeURIComponent(start.toISOString().replace(/\.\d+Z$/, '.000')) +
    '&pubEndDate=' + encodeURIComponent(end.toISOString().replace(/\.\d+Z$/, '.999'));
  const out = [];
  const stats = [];
  for (let i = 0; i < NVD_CPES.length; i++) {
    const c = NVD_CPES[i];
    const url = 'https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=' + encodeURIComponent(c.cpe) + '&' + q;
    const got = await fetchText(url, { accept: 'application/json', timeout: 20000 });
    if (!got.ok) { stats.push(c.label + ':실패'); if (i < NVD_CPES.length - 1) await sleep(6500); continue; }
    let j = null;
    try { j = JSON.parse(got.text); } catch (e) { j = null; }
    let n = 0;
    const vulns = (j && j.vulnerabilities) || [];
    for (const v of vulns.slice(0, 20)) {
      const cve = (v && v.cve) || {};
      const desc = ((cve.descriptions || []).filter(function (d) { return d.lang === 'en'; })[0] || {}).value || '';
      const score = ((cve.metrics || {}).cvssMetricV31 || (cve.metrics || {}).cvssMetricV40 || (cve.metrics || {}).cvssMetricV30 || [{}])[0];
      const sev = (score && score.cvssData && score.cvssData.baseSeverity) || (score && score.cvssData && score.cvssData.baseScore) || '';
      out.push({
        source: 'NVD', feed: 'nvd', title: clip((cve.id || 'CVE') + ' · ' + c.label + (sev ? ' · ' + sev : ''), 160),
        url: 'https://nvd.nist.gov/vuln/detail/' + encodeURIComponent(cve.id || ''),
        published: isoOf(Date.parse(cve.published || '') || 0), ms: Date.parse(cve.published || '') || 0,
        snippet: clip(desc, 420), severity: String(sev || '')
      });
      n++;
    }
    stats.push(c.label + ':' + n);
    if (i < NVD_CPES.length - 1) await sleep(6500);   /* 키 없는 NVD 는 30초에 5회 제한 */
  }
  return { items: out, error: stats.join(' / ') };
}

/* ---------- CISA KEV (실제 악용된 취약점) ---------- */
async function collectKev(days) {
  const got = await fetchText('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { accept: 'application/json', timeout: 20000 });
  if (!got.ok) return { items: [], error: got.error || ('HTTP ' + got.status) };
  let j = null;
  try { j = JSON.parse(got.text); } catch (e) { j = null; }
  if (!j || !Array.isArray(j.vulnerabilities)) return { items: [], error: '형식 오류' };
  const since = Date.now() - (days || 60) * 86400000;
  const hit = j.vulnerabilities.filter(function (v) {
    const t = Date.parse(v.dateAdded || '');
    if (!t || t < since) return false;
    const vp = String(v.vendorProject || '') + ' ' + String(v.product || '');
    return /oracle|mysql|postgres/i.test(vp);
  });
  return {
    items: hit.slice(0, 8).map(function (v) {
      return {
        source: 'CISA KEV', feed: 'kev',
        title: clip((v.cveID || '') + ' · ' + (v.vendorProject || '') + ' ' + (v.product || ''), 160),
        url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
        published: isoOf(Date.parse(v.dateAdded || '') || 0), ms: Date.parse(v.dateAdded || '') || 0,
        snippet: clip((v.vulnerabilityName || '') + ' · ' + (v.shortDescription || ''), 380)
      };
    }),
    error: hit.length ? '' : '최근 해당 제품 없음'
  };
}

/* ---------- Oracle Critical Patch Update 일정 (HTML) ---------- */
async function collectOracleCpu() {
  const got = await fetchText('https://www.oracle.com/security-alerts/', { accept: 'text/html', timeout: 20000 });
  if (!got.ok) return { items: [], error: got.error || ('HTTP ' + got.status) };
  const text = stripHtml(got.text);
  const out = [];
  const re = /Critical Patch Update - ([A-Z][a-z]+ \d{4})\s+Rev \d+, (\d{1,2} [A-Z][a-z]+ \d{4})/g;
  let m, n = 0;
  while ((m = re.exec(text)) && n < 2) {
    const ms = parseFeedDate(m[2]);
    out.push({
      source: 'Oracle 보안 공지', feed: 'oracle-cpu',
      title: clip('Oracle Critical Patch Update · ' + m[1] + ' (Rev 최신, ' + m[2] + ')', 160),
      url: 'https://www.oracle.com/security-alerts/', published: isoOf(ms), ms: ms,
      snippet: clip('Oracle 정기 보안 패치(CPU) 공지. ' + m[1] + ' CPU 최신 개정이 ' + m[2] + ' 에 나왔어요. CPU 는 매년 1·4·7·10월 셋째 화요일에 나옵니다.', 320)
    });
    n++;
  }
  const next = text.match(/next four dates are:\s*([\d]{1,2} [A-Z][a-z]+ \d{4}[\s\S]{0,80})/);
  if (next) {
    const dates = (next[1].match(/\d{1,2} [A-Z][a-z]+ \d{4}/g) || []).slice(0, 4);
    if (dates.length) {
      out.push({
        source: 'Oracle 보안 공지', feed: 'oracle-cpu',
        title: 'Oracle CPU 다음 일정 · ' + dates.join(' / '),
        url: 'https://www.oracle.com/security-alerts/', published: nowIso(), ms: Date.now(),
        snippet: '앞으로의 Oracle Critical Patch Update 날짜(온프레미스 DB 패치 계획용). ' + dates.join(', ')
      });
    }
  }
  return { items: out, error: out.length ? '' : '일정을 찾지 못했어요' };
}

/* ---------- 지원 버전·EOL (endoflife.date 공개 API, 사실 데이터) ---------- */
const EOL_PRODUCTS = [
  { slug: 'mysql', name: 'MySQL' },
  { slug: 'oracle-database', name: 'Oracle Database' },
  { slug: 'postgresql', name: 'PostgreSQL' },
  { slug: 'amazon-aurora-mysql', name: 'Amazon Aurora MySQL' },
  { slug: 'clickhouse', name: 'ClickHouse' },
  { slug: 'duckdb', name: 'DuckDB' },
  { slug: 'vitess', name: 'Vitess' }
];
async function collectVersions() {
  const out = [];
  for (const p of EOL_PRODUCTS) {
    const got = await fetchText('https://endoflife.date/api/' + p.slug + '.json', { accept: 'application/json', timeout: 12000 });
    if (!got.ok) continue;
    let arr = null;
    try { arr = JSON.parse(got.text); } catch (e) { arr = null; }
    if (!Array.isArray(arr)) continue;
    for (const c of arr.slice(0, 3)) {
      if (!c || !c.cycle) continue;
      out.push({
        product: p.name,
        cycle: String(c.cycle),
        latest: c.latest ? String(c.latest) : '',
        released: /^\d{4}-\d{2}-\d{2}/.test(String(c.releaseDate || '')) ? String(c.releaseDate).slice(0, 10) : '',
        supportEnd: /^\d{4}-\d{2}-\d{2}/.test(String(c.support || '')) ? String(c.support).slice(0, 10) : '',
        eol: /^\d{4}-\d{2}-\d{2}/.test(String(c.eol || '')) ? String(c.eol).slice(0, 10) : '',
        lts: !!c.lts,
        url: 'https://endoflife.date/' + p.slug
      });
    }
  }
  return out;
}

/* ---------- URL 정규화·중복 제거 ---------- */
function normUrl(u) {
  return String(u || '')
    .replace(/[?#].*$/, '')
    .replace(/^http:/i, 'https:')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(www\.)?/i, '')
    .toLowerCase();
}
function dedupe(items) {
  const byUrl = {}, out = [];
  for (const it of items) {
    const k = normUrl(it.url);
    if (!k) continue;
    if (byUrl[k]) {
      /* 같은 기사면 더 긴 요약을 남긴다 */
      if (String(it.snippet || '').length > String(byUrl[k].snippet || '').length) byUrl[k].snippet = it.snippet;
      continue;
    }
    const t = String(it.title || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 60);
    let dup = false;
    for (const o of out) {
      const t2 = String(o.title || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 60);
      if (t && t2 && t === t2) { dup = true; break; }
    }
    if (dup) continue;
    byUrl[k] = it;
    out.push(it);
  }
  return out;
}

/* 어제 브리핑에서 이미 다룬 기사 표시 */
async function loadPreviousUrls() {
  const set = {};
  if (FLAG_NO_PREV()) return set;
  const r = await ghRead(P_OUT_DIR + '/latest.json');
  if (!r.ok || r.missing) return set;
  let j = null;
  try { j = JSON.parse(r.text); } catch (e) { j = null; }
  if (!j) return set;
  /* 같은 날 다시 돌린 경우(수동 재실행)에는 '어제'로 보지 않는다 */
  if (String(j.date || '') === TODAY) return set;
  const src = Array.isArray(j.sources) ? j.sources : [];
  for (const s of src) { const k = normUrl(s && s.url); if (k) set[k] = 1; }
  for (const sec of (Array.isArray(j.sections) ? j.sections : [])) {
    for (const it of ((sec && sec.items) || [])) { const k = normUrl(it && it.url); if (k) set[k] = 1; }
  }
  return set;
}
function FLAG_NO_PREV() { return flag('no-prev'); }

/* ---------- 최근 7일 브리핑에 이미 다룬 기사 (중복 보고 방지) ---------- */
function titleKey(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 60);
}
/* 오늘까지 n일 날짜(KST, 오래된 날 → 오늘) */
function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(kstParts(new Date(now - i * 86400000)).date);
  return out;
}
/* 오늘을 뺀 지난 7일 브리핑에 실린 URL·제목 */
async function loadCovered7() {
  const set = { urls: {}, titles: {}, days: [] };
  if (FLAG_NO_PREV()) return set;
  for (const d of lastDays(8)) {
    if (d === TODAY) continue;
    const r = await ghRead(P_OUT_DIR + '/' + d + '.json');
    if (!r.ok) { warn('지난 브리핑을 읽지 못했어요 · ' + d + ' · ' + (r.error || '')); continue; }
    if (r.missing) continue;
    let j = null;
    try { j = JSON.parse(r.text); } catch (e) { j = null; }
    if (!j) continue;
    set.days.push(d);
    for (const so of (Array.isArray(j.sources) ? j.sources : [])) { const k = normUrl(so && so.url); if (k) set.urls[k] = 1; }
    for (const it of (Array.isArray(j.items) ? j.items : [])) { const k = normUrl(it && it.url); if (k) set.urls[k] = 1; }
    for (const sec of (Array.isArray(j.sections) ? j.sections : [])) {
      for (const it of ((sec && sec.items) || [])) {
        const k = normUrl(it && it.url); if (k) set.urls[k] = 1;
        const t = titleKey(it && it.title); if (t) set.titles[t] = 1;
      }
    }
  }
  return set;
}

/* ==================================================================
   수집 전체 실행
   ================================================================== */
async function collectAll(covered) {
  const t0 = Date.now();
  const tasks = [];

  for (const f of FEEDS) {
    tasks.push((async function () {
      const r = await collectRss(f);
      const items = r.items.filter(function (it) { return f.tag === 'security' || relevantItem(it, f.tag); });
      return { feed: f, items: items, error: r.error, raw: r.items.length };
    })());
  }
  tasks.push((async function () {
    const r = await collectHn();
    return { feed: { id: 'hn', name: 'Hacker News (48시간)' }, items: r.items, error: r.error, raw: r.items.length };
  })());
  tasks.push((async function () {
    const r = await collectNvd(Number(opt('nvd-days', 30)) || 30);
    return { feed: { id: 'nvd', name: 'NVD CVE (30일)' }, items: r.items, error: r.error, raw: r.items.length };
  })());
  tasks.push((async function () {
    const r = await collectKev(60);
    return { feed: { id: 'kev', name: 'CISA KEV' }, items: r.items, error: r.error, raw: r.items.length };
  })());
  tasks.push((async function () {
    const r = await collectOracleCpu();
    return { feed: { id: 'oracle-cpu', name: 'Oracle 보안 공지' }, items: r.items, error: r.error, raw: r.items.length };
  })());
  const versionsPromise = collectVersions().catch(function () { return []; });

  const settled = await Promise.all(tasks);
  const versions = await versionsPromise;
  const feedStats = [];
  let all = [];
  for (const s of settled) {
    feedStats.push({
      id: s.feed.id, name: s.feed.name, ok: s.items.length > 0,
      count: s.items.length, raw: s.raw || 0, error: s.error || ''
    });
    all = all.concat(s.items);
  }
  all = dedupe(all);

  /* 최근 7일 브리핑에 이미 실린 기사는 64건을 고르기 전에 뺀다. */
  const cov = covered || { urls: {}, titles: {} };
  let skippedOld = 0;
  all = all.filter(function (it) {
    const k = normUrl(it.url), t = titleKey(it.title);
    if ((k && cov.urls && cov.urls[k]) || (t && cov.titles && cov.titles[t])) { skippedOld += 1; return false; }
    return true;
  });

  /* 최신 기사 우선, 보안/CVE 는 조금 더 위로 */
  all.sort(function (a, b) {
    const pa = (b.ms || 0) - (a.ms || 0);
    return pa;
  });
  /* 날짜만 보고 자르면 릴리스가 드문 프로젝트(Vitess·StarRocks 등)는 기사가 있어도
     목록에서 통째로 밀려나 볼 수 없다. 기사가 있는데 한 건도 못 들어간 피드는 가장 최신
     1건을 넣고, 같은 수만큼 가장 오래된 기사를 뺀다. */
  let finalItems = all.slice(0, MAX_ITEMS);
  const pickedFeeds = {};
  finalItems.forEach(function (it) { pickedFeeds[it.feed] = 1; });
  const rescue = [];
  for (const f of feedStats) {
    if (!f.count || pickedFeeds[f.id]) continue;
    const newest = all.filter(function (x) { return x.feed === f.id; })
      .sort(function (a, b) { return (Number(a.ord) || 0) - (Number(b.ord) || 0); })[0];
    if (newest) { rescue.push(newest); pickedFeeds[f.id] = 1; }
  }
  if (rescue.length) {
    finalItems = finalItems.slice(0, Math.max(0, MAX_ITEMS - rescue.length)).concat(rescue);
    finalItems.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
  }
  const picked = finalItems;
  picked.forEach(function (it, i) { it.ref = i + 1; });

  return { items: picked, total: all.length, skipped: skippedOld, feedStats: feedStats, versions: versions, ms: Date.now() - t0 };
}

/* ==================================================================
   프롬프트
   ================================================================== */
const SECTIONS = [
  { id: 'security', title: '🔐 보안 패치·CVE', max: 6, hint: 'Oracle CPU/MySQL·PostgreSQL 보안 패치, 신규 CVE, 실제 악용(KEV), 금융권 감사에서 문제되는 취약점. 버전·CVE 번호를 정확히.' },
  { id: 'ops', title: '🛠 Oracle·MySQL 운영', max: 6, hint: 'Oracle·MySQL(그리고 Aurora MySQL)의 엔터프라이즈 운영·성능·HA/복제·무중단 변경·업그레이드·라이선스 변화·장애 사례. PostgreSQL 단독 소식은 cloud 섹션으로 보내세요.' },
  { id: 'analytics', title: '📈 대용량 분석 DB·Vitess', max: 4, hint: 'ClickHouse·StarRocks·Apache Doris·DuckDB 같은 분석(OLAP) 엔진의 릴리스·기능·운영 사례와 Vitess(MySQL 샤딩·스케일아웃) 동향. 증권사 로그·시세·체결 데이터의 대용량 적재·집계, MySQL 수평 분할·무중단 스키마 변경·커넥션 라우팅 관점에서 무엇을 검토하게 되는지 적으세요. 같은 제품의 단순 버전업만 여러 개면 최신 1개만.' },
  { id: 'cloud', title: '☁️ PostgreSQL·클라우드 비교', max: 4, hint: 'PostgreSQL 신버전·기능, Aurora/RDS 등 클라우드 DB 소식 중 사내 Oracle·MySQL 운영과 비교해 참고할 만한 것.' },
  { id: 'ai', title: '🤖 AI × DBA', max: 4, hint: '온프레미스/프라이빗 LLM 구축, DB 연동 시 권한 제어·민감정보 마스킹·감사 로그, Text-to-SQL·AIOps 같은 DBA 생산성 도구. 퍼블릭 SaaS 홍보성 기사는 낮게.' },
  { id: 'finance', title: '🏦 금융권·규제 동향', max: 4, hint: '망분리·전자금융감독규정·보안성 심의·감사·개인정보·장애 대응 규제 변화와 금융권 IT 사고.' }
];

function buildSystemPrompt() {
  return [
    '당신은 증권사(금융권)에서 Oracle·MySQL을 운영하는 DBA를 돕는 "리서치팀"입니다.',
    '독자: 2009년부터 DBA, 주력 MySQL, Oracle·PostgreSQL·AWS Aurora MySQL 7~8년 운영. 2025년 1월부터 증권사에서 Oracle+MySQL 담당. 2026년 4월~12월 육아휴직, 2027년 1월 11일 복귀 예정.',
    '독자의 환경: 망분리·폐쇄망, 보안 심의·감사, 변경 관리(무중단), 고가용성(HA), 장애 대응이 핵심. 퍼블릭 SaaS 도입은 어렵고 사내 구축형이 현실적.',
    '독자의 관심사: MySQL·Oracle 운영에 더해, 시세·체결·주문 로그처럼 계속 커지는 데이터를 다루는 대용량 분석(OLAP) DB(ClickHouse·StarRocks·Apache Doris·DuckDB)와 MySQL 샤딩·스케일아웃(Vitess) 동향. 금융권 감사·망분리 때문에 사내에 직접 구축할 수 있는 오픈소스 위주로 봅니다.',
    '',
    '지켜야 할 규칙:',
    '1) 반드시 JSON 하나만 출력합니다. 설명·인사말·코드블록 표시를 붙이지 마세요.',
    '2) 입력으로 주는 [수집 기사] 목록에 있는 사실만 씁니다. 목록에 없는 버전·날짜·CVE 번호·회사·URL·수치를 만들지 마세요.',
    '3) 각 항목은 반드시 "ref"에 그 근거가 된 기사 번호(정수)를 적습니다. URL·출처는 시스템이 그 번호로 채우므로 쓰지 않아도 됩니다.',
    '4) 확실하지 않으면 summary 안에 "확인 필요"라고 적고 단정하지 마세요. 추측을 사실처럼 쓰면 안 됩니다.',
    '5) 한국어로 씁니다. 제품명·명령·버전·CVE ID 같은 기술 용어는 원어 그대로 둡니다.',
    '6) 각 항목의 "finance"에는 "그래서 금융권 DBA인 독자에게 무엇이 달라지는가"를 한 문장으로 씁니다(패치 일정, 변경 관리, 감사 대응, 복귀 후 할 일 등).',
    '7) 관련 없는 기사는 억지로 넣지 말고 빼세요. 다만 근거 기사가 있는 섹션은 비우지 말고 2개 이상 채우세요.',
    '8) "[어제 다룬 기사]" 표시가 붙은 기사는 어제 브리핑에서 이미 다룬 것입니다. 새 버전·새 CVE·새 일정 같은 진전이 없으면 빼고, 되도록 새 기사로 채우세요.',
    '9) 대용량 분석 DB·Vitess 항목의 "finance"에는 증권사 로그·시세·체결 데이터의 대용량 적재·집계, MySQL 수평 분할·무중단 스키마 변경 같은 실무 관점에서 무엇을 검토하게 되는지 씁니다. 아직 사내 표준이 아니므로 "도입 검토 후보" 정도로 쓰고, 이미 도입했다고 쓰지 마세요.',
    '',
    '출력 JSON 형식(키 이름을 그대로 사용):',
    '{',
    '  "headline": ["오늘의 핵심 1", "핵심 2", "핵심 3"],',
    '  "sections": {',
    '    "security": [{"ref": 3, "title": "항목 제목", "summary": "1~2문장 요약", "finance": "금융권 관점 한 문장"}],',
    '    "ops": [...], "analytics": [...], "cloud": [...], "ai": [...], "finance": [...]',
    '  },',
    '  "actions": [{"phase": "복귀 전|복귀 1주|복귀 1개월", "todo": "할 일", "why": "이유", "ref": 5}],',
    '  "watch": ["계속 지켜볼 것 1", "2"]',
    '}',
    'headline 은 정확히 3개, 각 90자 이내. actions 는 2~4개. watch 는 2~3개.'
  ].join('\n');
}

function buildUserPrompt(items, feedStats) {
  const lines = [];
  lines.push('[오늘] ' + NOW_LABEL + ' · 대상 날짜 ' + TODAY);
  lines.push('[수집] 기사 ' + items.length + '건 (중복 제거 후, 최근 것 우선). 아래 목록에 없는 내용은 쓰지 마세요.');
  lines.push('');
  for (const it of items) {
    lines.push('#' + it.ref + (it.seen ? ' [어제 다룬 기사]' : '') + ' [' + it.source + (it.published ? ' · ' + it.published.slice(0, 10) : '') + '] ' + it.title);
    if (it.snippet) lines.push('    ' + clip(it.snippet, 300));
  }
  lines.push('');
  lines.push('[섹션별로 담을 것]');
  for (const s of SECTIONS) lines.push('- ' + s.id + ' (최대 ' + s.max + '개): ' + s.hint);
  lines.push('');
  lines.push('[참고] 피드 수집 상태: ' + feedStats.filter(function (f) { return f.count > 0; }).map(function (f) { return f.name + ' ' + f.count; }).join(', '));
  lines.push('[요청] 위 기사만 근거로, 오늘 아침 독자가 3분 안에 읽을 데일리 브리핑 JSON 을 만드세요.');
  return lines.join('\n');
}

/* ==================================================================
   AI 호출 — OpenRouter → Groq → Gemini
   ================================================================== */
const PROVIDERS = [
  {
    id: 'openrouter', label: 'OpenRouter', url: OPENROUTER_URL,
    models: (process.env.DBA_OR_MODELS ? String(process.env.DBA_OR_MODELS).split(',') : [
      'nvidia/nemotron-3.5-lightning:free', 'particle-ai/particle-1:free', 'baidu/ernie-5.5-flash-preview:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'
    ]),
    extraHeaders: { 'HTTP-Referer': 'https://jadenfamily.github.io/home/office.html', 'X-Title': 'jadenfamily DBA Research' },
    /* 무료 추론형 모델이 본문 없이 reasoning 만 쓰고 끝나지 않게 추론을 줄인다 */
    extra: { reasoning: { effort: 'low' } }
  },
  {
    id: 'groq', label: 'Groq', url: GROQ_URL,
    models: (process.env.DBA_GROQ_MODELS ? String(process.env.DBA_GROQ_MODELS).split(',') : [
      'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'
    ]),
    extra: { reasoning_effort: 'low' }
  },
  {
    id: 'gemini', label: 'Gemini',
    models: (process.env.DBA_GEMINI_MODELS ? String(process.env.DBA_GEMINI_MODELS).split(',') : [
      'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'
    ])
  }
];

async function postJson(url, headers, body, timeout) {
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, timeout || AI_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ac.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text, ms: Date.now() - t0 };
  } catch (e) {
    const to = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
    return { ok: false, status: 0, timeout: to, error: to ? ('응답 없음(' + Math.round((timeout || AI_TIMEOUT_MS) / 1000) + '초 초과)') : String((e && e.message) || e), ms: Date.now() - t0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}
function errText(got) {
  if (got.timeout) return got.error;
  let msg = 'HTTP ' + got.status;
  try {
    const j = JSON.parse(got.text);
    const m = (j.error && (j.error.message || j.error)) || j.message || (Array.isArray(j) && j[0] && j[0].error && j[0].error.message);
    if (m) msg = String(m);
  } catch (e) { msg = clip(got.text || msg, 160); }
  return clip(msg, 200);
}

async function callOpenAiStyle(provider, model, key, system, user, maxTokens) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'User-Agent': UA };
  Object.assign(headers, provider.extraHeaders || {});
  const body = {
    model: model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.25,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  };
  if (provider.extra) Object.assign(body, provider.extra);
  const got = await postJson(provider.url, headers, body);
  if (!got.ok && got.status === 400 && /response_format|json_object|json mode/i.test(errText(got))) {
    /* JSON 모드를 싫어하는 모델은 일반 모드로 한 번 더 */
    delete body.response_format;
    const again = await postJson(provider.url, headers, body);
    return finishOpenAiStyle(again, model);
  }
  return finishOpenAiStyle(got, model);
}
function finishOpenAiStyle(got, model) {
  if (!got.ok) return { ok: false, status: got.status, error: errText(got), timeout: !!got.timeout };
  let j = null;
  try { j = JSON.parse(got.text); } catch (e) { return { ok: false, status: got.status, error: '응답이 JSON 이 아니에요' }; }
  const ch = (j.choices || [])[0] || {};
  const msg = ch.message || {};
  let text = msg.content;
  if (Array.isArray(text)) text = text.map(function (p) { return (p && p.text) || ''; }).join('');
  if (!String(text || '').trim()) return { ok: false, status: got.status, error: '빈 답변' + (msg.reasoning ? ' (추론만 하고 본문 없음)' : ''), empty: true };
  return { ok: true, text: String(text), model: model, ms: got.ms, usage: j.usage || null };
}

async function callGemini(model, key, system, user, maxTokens) {
  const url = GEMINI_BASE + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.25, maxOutputTokens: maxTokens, responseMimeType: 'application/json' }
  };
  const got = await postJson(url, { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'User-Agent': UA }, body);
  if (!got.ok) return { ok: false, status: got.status, error: errText(got), timeout: !!got.timeout };
  let j = null;
  try { j = JSON.parse(got.text); } catch (e) { return { ok: false, status: got.status, error: '응답이 JSON 이 아니에요' }; }
  const cand = (j.candidates || [])[0] || {};
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.map(function (p) { return (p && p.text) || ''; }).join('');
  if (!text.trim()) {
    const blocked = j.promptFeedback && j.promptFeedback.blockReason;
    return { ok: false, status: got.status, empty: true, error: blocked ? ('안전 정책으로 막힘 (' + blocked + ')') : ('빈 답변 (' + (cand.finishReason || '?') + ')') };
  }
  return { ok: true, text: text, model: model, ms: got.ms, usage: j.usageMetadata || null };
}

function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const cand = t.slice(a, b + 1);
  try { return JSON.parse(cand); } catch (e) { /* 아래에서 한 번 더 */ }
  try { return JSON.parse(cand.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"')); } catch (e) { return null; }
}

/* 모델이 고른 ref 를 실제 수집 기사로 바꿔 준다(URL 을 모델이 만들 수 없게) */
const SECTION_BY_ID = {};
SECTIONS.forEach(function (s) { SECTION_BY_ID[s.id] = s; });

function normalizeBrief(raw, items) {
  const byRef = {};
  items.forEach(function (it) { byRef[it.ref] = it; });
  const usedRefs = {};
  function pickList(arr, max) {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < arr.length && out.length < max; i++) {
      const o = arr[i];
      if (!o || typeof o !== 'object') continue;
      const ref = Number(o.ref);
      const src = byRef[ref];
      if (!src) continue;                     /* 목록에 없는 근거는 버린다 */
      const title = clip(o.title || src.title, 140);
      const summary = clip(o.summary || '', 500);
      if (!title || !summary) continue;
      out.push({
        ref: ref, title: title, summary: summary, finance: clip(o.finance || '', 300),
        url: src.url, source: src.source, published: src.published || ''
      });
      usedRefs[ref] = 1;
    }
    return out;
  }
  const secOut = [];
  const rawSec = (raw && raw.sections) || {};
  for (const s of SECTIONS) {
    const list = pickList(rawSec[s.id] || rawSec[s.title] || [], s.max);
    secOut.push({ id: s.id, title: s.title, items: list });
  }
  const headline = (Array.isArray(raw && raw.headline) ? raw.headline : []).filter(function (x) { return typeof x === 'string' && x.trim(); })
    .slice(0, 3).map(function (x) { return clip(x, 120); });
  const actions = [];
  if (Array.isArray(raw && raw.actions)) {
    for (const a of raw.actions) {
      if (!a || typeof a !== 'object') continue;
      const todo = clip(a.todo || a.action || '', 200);
      if (!todo) continue;
      const ref = Number(a.ref);
      actions.push({
        phase: clip(a.phase || '복귀 전', 20), todo: todo, why: clip(a.why || '', 200),
        url: byRef[ref] ? byRef[ref].url : '', ref: byRef[ref] ? ref : 0
      });
      if (actions.length >= 5) break;
    }
  }
  const watch = (Array.isArray(raw && raw.watch) ? raw.watch : []).filter(function (x) { return typeof x === 'string' && x.trim(); })
    .slice(0, 4).map(function (x) { return clip(x, 160); });
  const used = Object.keys(usedRefs).map(function (k) { return byRef[k]; })
    .sort(function (a, b) { return a.ref - b.ref; })
    .map(function (it) { return { ref: it.ref, title: it.title, url: it.url, source: it.source, published: it.published || '' }; });
  const totalSections = secOut.reduce(function (n, s) { return n + s.items.length; }, 0);
  return { headline: headline, sections: secOut, actions: actions, watch: watch, used: used, totalSections: totalSections };
}

async function runAi(keys, system, user, items) {
  const attempts = [];
  const order = ['openrouter', 'groq', 'gemini'];   /* OpenRouter·Groq 우선, Gemini 는 최후 폴백 */
  for (const pid of order) {
    const prov = PROVIDERS.filter(function (p) { return p.id === pid; })[0];
    const list = (keys[pid] || []).filter(Boolean);
    if (!list.length) { attempts.push(pid + ': 키 없음'); continue; }
    let emptyCount = 0;
    for (const model of prov.models) {
      const key = list[0];
      log('AI 호출 · ' + prov.label + ' ' + model);
      let res = pid === 'gemini'
        ? await callGemini(model, key, system, user, 8000)
        : await callOpenAiStyle(prov, model, key, system, user, 8000);
      /* 한도(429)·혼잡(503)은 잠깐 쉬었다 한 번 더 */
      if (!res.ok && (res.status === 429 || res.status === 503)) {
        const wait = res.status === 429 ? 8000 : 4000;
        warn(prov.label + ' ' + model + ' · ' + res.error + ' · ' + Math.round(wait / 1000) + '초 뒤 한 번 더');
        await sleep(wait);
        res = pid === 'gemini'
          ? await callGemini(model, key, system, user, 8000)
          : await callOpenAiStyle(prov, model, key, system, user, 8000);
      }
      if (res.ok) {
        const json = extractJson(res.text);
        if (!json) {
          attempts.push(prov.label + '/' + model + ': JSON 아님');
          warn('JSON 으로 읽지 못했어요(' + String(res.text).length + '자) · ' + clip(res.text, 160));
          continue;
        }
        const brief = normalizeBrief(json, items);
        if (brief.totalSections < 3) {
          const keys_ = Object.keys(json || {}).join(',');
          attempts.push(prov.label + '/' + model + ': 쓸 수 있는 항목 ' + brief.totalSections + '개');
          warn('결과를 쓰기 어려워요 · 항목 ' + brief.totalSections + '개 · 키[' + clip(keys_, 80) + '] · ' + clip(res.text, 160));
          continue;   /* 다음 모델로 */
        }
        return { ok: true, brief: brief, provider: prov, model: model, ms: res.ms };
      }
      attempts.push(prov.label + '/' + model + ': ' + res.error);
      warn('실패 · ' + prov.label + ' ' + model + ' · ' + res.error);
      /* 401/403 은 키 문제이므로 이 제공자의 나머지 모델은 건너뛴다 */
      if (res.status === 401 || res.status === 403) break;
      /* 같은 제공자에서 두 번 연속 빈 답변이면 설정 문제로 보고 다음 제공자로 넘어간다 */
      if (res.empty) { emptyCount++; if (emptyCount >= 2) { warn(prov.label + ' 빈 답변이 반복돼 다음 제공자로 넘어갑니다.'); break; } }
    }
  }
  return { ok: false, attempts: attempts };
}

/* ==================================================================
   본문 텍스트(사무실 기록·로그용)
   ================================================================== */
function briefToText(brief, date) {
  const L = [];
  L.push('📰 ' + date + ' 금융권 DBA 데일리 브리핑');
  if (brief.headline.length) { L.push(''); brief.headline.forEach(function (h, i) { L.push((i + 1) + '. ' + h); }); }
  for (const s of brief.sections) {
    if (!s.items.length) continue;
    L.push('');
    L.push('[' + s.title + ']');
    s.items.forEach(function (it) { L.push('· ' + it.title + ' — ' + it.summary + (it.url ? ' (' + it.url + ')' : '')); });
  }
  if (brief.actions.length) {
    L.push('');
    L.push('[복귀 준비]');
    brief.actions.forEach(function (a) { L.push('· (' + a.phase + ') ' + a.todo + (a.why ? ' — ' + a.why : '')); });
  }
  return L.join('\n');
}

/* ==================================================================
   주간 요약 — 매주 월요일, 지난 7일 데일리 브리핑을 한 장으로
   ================================================================== */
function buildWeeklySystemPrompt() {
  return [
    '당신은 증권사(금융권)에서 Oracle·MySQL을 운영하는 DBA를 돕는 "리서치팀"입니다.',
    '지난 7일간의 데일리 브리핑을 모아 한 장짜리 주간 요약을 만듭니다.',
    '독자: 2009년부터 DBA, 주력 MySQL, Oracle·PostgreSQL·Aurora MySQL 운영. 2026년 4월~12월 육아휴직, 2027년 1월 11일 복귀 예정.',
    '',
    '지켜야 할 규칙:',
    '1) 반드시 JSON 하나만 출력합니다. 설명·인사말·코드블록 표시를 붙이지 마세요.',
    '2) 입력으로 주는 데일리 브리핑 내용만 씁니다. 없는 버전·날짜·CVE·회사·URL을 만들지 마세요.',
    '3) 한국어로 씁니다. 제품명·버전·CVE ID는 원어 그대로 둡니다.',
    '4) headline 은 정확히 3개, 각 90자 이내. 이번 주에 가장 중요한 변화만.',
    '5) trends 는 2~5개. 한 주에 걸쳐 이어진 흐름을 묶어 씁니다. items 에는 근거가 된 데일리 항목의 제목·URL을 그대로 옮깁니다.',
    '6) changes 는 2~4개. 무엇이 바뀌었나(area) / 무엇이 달라지나(what) / 그래서 무엇을 하나(why).',
    '7) returnPrep 은 2~4개. 복귀(2027-01-11) 전에 해 둘 일을 phase(복귀 전·복귀 1주·복귀 1개월)로 나눠 적습니다.',
    '8) sources 에는 실제로 쓴 기사만 넣습니다.',
    '',
    '출력 JSON 형식:',
    '{',
    '  "headline": ["...", "...", "..."],',
    '  "trends": [{"title": "...", "summary": "...", "items": [{"title": "...", "url": "...", "source": "...", "published": "..."}]}],',
    '  "changes": [{"area": "...", "what": "...", "why": "..."}],',
    '  "returnPrep": [{"phase": "복귀 전", "todo": "...", "why": "..."}],',
    '  "sources": [{"title": "...", "url": "...", "source": "...", "published": "..."}]',
    '}'
  ].join('\n');
}
async function readWeekBriefs(days) {
  const out = [];
  for (const d of days) {
    const r = await ghRead(P_OUT_DIR + '/' + d + '.json');
    if (!r.ok || r.missing) continue;
    let j = null;
    try { j = JSON.parse(r.text); } catch (e) { j = null; }
    if (!j) continue;
    if (!j.date) j.date = d;
    out.push(j);
  }
  return out;
}
function buildWeeklyPrompt(briefs, days) {
  const L = [];
  L.push('[기간] ' + (days[0] || '') + ' ~ ' + (days[days.length - 1] || '') + ' (지난 7일)');
  L.push('[자료] 데일리 브리핑 ' + briefs.length + '일치. 여기에 없는 내용은 쓰지 마세요.');
  for (const b of briefs) {
    L.push('');
    L.push('## ' + (b.date || '') + (b.weekday ? ' (' + b.weekday + ')' : ''));
    for (const h of (Array.isArray(b.headline) ? b.headline : []).slice(0, 3)) L.push('- ' + h);
    for (const sec of (Array.isArray(b.sections) ? b.sections : [])) {
      const items = (sec && sec.items) || [];
      if (!items.length) continue;
      L.push('[' + (sec.title || sec.id || '') + ']');
      for (const it of items.slice(0, 6)) {
        L.push('· ' + it.title + ' — ' + clip(it.summary, 220) + (it.url ? ' (' + it.url + ')' : ''));
      }
    }
  }
  L.push('');
  L.push('[요청] 위 자료만 근거로 이번 주 주간 요약 JSON 을 만드세요.');
  return L.join('\n');
}
async function runWeeklyAi(keys, system, user) {
  const attempts = [];
  const order = ['openrouter', 'groq', 'gemini'];
  for (const pid of order) {
    const prov = PROVIDERS.filter(function (p) { return p.id === pid; })[0];
    const list = (keys[pid] || []).filter(Boolean);
    if (!list.length) { attempts.push(pid + ': 키 없음'); continue; }
    let emptyCount = 0;
    for (const model of prov.models) {
      const key = list[0];
      log('주간 AI 호출 · ' + prov.label + ' ' + model);
      let res = pid === 'gemini'
        ? await callGemini(model, key, system, user, 8000)
        : await callOpenAiStyle(prov, model, key, system, user, 8000);
      if (!res.ok && (res.status === 429 || res.status === 503)) {
        const wait = res.status === 429 ? 8000 : 4000;
        warn(prov.label + ' ' + model + ' · ' + res.error + ' · ' + Math.round(wait / 1000) + '초 뒤 한 번 더');
        await sleep(wait);
        res = pid === 'gemini'
          ? await callGemini(model, key, system, user, 8000)
          : await callOpenAiStyle(prov, model, key, system, user, 8000);
      }
      if (res.ok) {
        const json = extractJson(res.text);
        if (json && Array.isArray(json.headline) && Array.isArray(json.trends)) {
          return { ok: true, data: json, provider: prov, model: model, ms: res.ms };
        }
        attempts.push(prov.label + '/' + model + ': 형식 아님');
        warn('주간 결과를 읽지 못했어요 · ' + clip(res.text, 160));
        continue;
      }
      attempts.push(prov.label + '/' + model + ': ' + res.error);
      warn('주간 실패 · ' + prov.label + ' ' + model + ' · ' + res.error);
      if (res.status === 401 || res.status === 403) break;
      if (res.empty) { emptyCount++; if (emptyCount >= 2) break; }
    }
  }
  return { ok: false, attempts: attempts };
}
function weeklyToText(w) {
  const L = ['📅 ' + w.date + ' 금융권 DBA 주간 요약 (' + w.weekStart + ' ~ ' + w.weekEnd + ')'];
  if (w.headline.length) { L.push(''); w.headline.forEach(function (h, i) { L.push((i + 1) + '. ' + h); }); }
  for (const t of w.trends) {
    L.push('');
    L.push('[주간 트렌드] ' + t.title);
    if (t.summary) L.push(t.summary);
    for (const it of (t.items || [])) L.push('· ' + it.title + (it.url ? ' (' + it.url + ')' : ''));
  }
  if (w.changes.length) { L.push(''); L.push('[핵심 변화]'); for (const c of w.changes) L.push('· ' + c.area + ' — ' + c.what + (c.why ? ' / ' + c.why : '')); }
  if (w.returnPrep.length) { L.push(''); L.push('[복귀 준비]'); for (const c of w.returnPrep) L.push('· (' + c.phase + ') ' + c.todo + (c.why ? ' — ' + c.why : '')); }
  return L.join('\n');
}
async function makeWeekly(keys) {
  const t0 = Date.now();
  const days = lastDays(7);
  const briefs = await readWeekBriefs(days);
  const out = {
    schema: 'dba-weekly-brief/1', date: TODAY, weekStart: days[0], weekEnd: days[days.length - 1],
    generatedAt: nowIso(), timezone: 'Asia/Seoul', status: 'ok', model: '',
    days: briefs.map(function (b) { return b.date; }),
    headline: [], trends: [], changes: [], returnPrep: [], sources: [], elapsedSec: 0
  };
  if (briefs.length < 2) {
    log('주간 요약 · 모은 데일리 브리핑이 ' + briefs.length + '일치라 건너뜁니다(2일 이상 필요).');
    return { ok: false, skipped: true };
  }
  const ai = await runWeeklyAi(keys, buildWeeklySystemPrompt(), buildWeeklyPrompt(briefs, days));
  if (ai.ok) {
    const d = ai.data;
    out.model = ai.provider.label + ' · ' + ai.model;
    out.headline = (Array.isArray(d.headline) ? d.headline : []).filter(function (x) { return typeof x === 'string' && x.trim(); })
      .slice(0, 3).map(function (x) { return clip(x, 120); });
    out.trends = (Array.isArray(d.trends) ? d.trends : []).slice(0, 5).map(function (t) {
      return {
        title: clip((t && t.title) || '', 140),
        summary: clip((t && t.summary) || '', 600),
        items: (Array.isArray(t && t.items) ? t.items : []).slice(0, 6).map(function (it) {
          return { title: clip((it && it.title) || '', 160), url: String((it && it.url) || ''), source: clip((it && it.source) || '', 60), published: String((it && it.published) || '') };
        })
      };
    }).filter(function (t) { return !!t.title; });
    out.changes = (Array.isArray(d.changes) ? d.changes : []).slice(0, 4).map(function (c) {
      return { area: clip((c && c.area) || '', 80), what: clip((c && c.what) || '', 400), why: clip((c && c.why) || '', 300) };
    });
    out.returnPrep = (Array.isArray(d.returnPrep) ? d.returnPrep : []).slice(0, 4).map(function (c) {
      return { phase: clip((c && c.phase) || '복귀 전', 20), todo: clip((c && c.todo) || '', 200), why: clip((c && c.why) || '', 200) };
    });
    out.sources = (Array.isArray(d.sources) ? d.sources : []).filter(function (s) { return s && s.url; }).slice(0, 30).map(function (s) {
      return { title: clip(s.title || '', 160), url: String(s.url), source: clip(s.source || '', 60), published: String(s.published || '') };
    });
    log('주간 요약 완료 · ' + out.model + ' · 트렌드 ' + out.trends.length + '개');
  } else {
    out.status = 'feed-only';
    console.log('::warning::주간 AI 요약에 모두 실패해 기사 목록만 남깁니다 · ' + (ai.attempts || []).join(' | '));
    const seen = {};
    for (const b of briefs) {
      for (const sec of (Array.isArray(b.sections) ? b.sections : [])) {
        for (const it of ((sec && sec.items) || [])) {
          if (!it || !it.url || seen[it.url]) continue;
          seen[it.url] = 1;
          out.sources.push({ title: clip(it.title || '', 160), url: String(it.url), source: clip(it.source || '', 60), published: String(it.published || '') });
        }
      }
    }
    out.sources = out.sources.slice(0, 40);
  }
  out.elapsedSec = Math.round((Date.now() - t0) / 1000);
  const txt = JSON.stringify(out, null, 2) + '\n';
  writeLocal(P_OUT_DIR + '/weekly-' + TODAY + '.json', txt);
  writeLocal(P_OUT_DIR + '/latest-weekly.json', txt);
  log('주간 요약 저장 · ' + P_OUT_DIR + '/weekly-' + TODAY + '.json · latest-weekly.json');
  if (!NO_OFFICE) {
    const rec = await upsertOfficeRecord({
      kind: 'weekly-brief', date: TODAY,
      titleOverride: '📅 금융권 DBA 주간 요약 · ' + TODAY,
      brief: '매주 월요일 09:40 KST 에 지난 7일 데일리 브리핑을 모아 만드는 주간 요약입니다. 핵심 변화·주간 트렌드·복귀 준비 체크를 정리했습니다.',
      report: {
        summary: clip((out.headline[0] || '금융권 DBA 주간 요약'), 120),
        detail: trunc(weeklyToText(out), 3500),
        next: [{ label: 'latest-weekly.json 확인 · 필요하면 피클에게 후속 정리 요청', teamId: '' }],
        verdict: '', at: nowIso()
      },
      logs: ['데일리 ' + briefs.length + '일치', '주간 모델 ' + (out.model || '없음'), '주간 저장 · weekly-' + TODAY + '.json']
    });
    if (rec.ok) log('사무실 기록 · ' + rec.id + ' (주간)');
    else warn('주간 사무실 기록 실패 · ' + rec.error);
  }
  return { ok: true, weekly: out };
}

/* ==================================================================
   사무실(office-state.json) 기록 — 리서치팀 완료 1건
   ================================================================== */
async function upsertOfficeRecord(payload) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await ghRead(P_OFFICE);
    if (!r.ok) return { ok: false, error: 'office-state.json 읽기 실패 · ' + (r.error || '') };
    if (r.missing) return { ok: false, error: 'office-state.json 이 없어요' };
    let env = null;
    try { env = JSON.parse(r.text); } catch (e) { return { ok: false, error: 'office-state.json 형식 오류' }; }
    let state = null;
    if (env && env.ct && env.iv) {
      try { state = await familyDecrypt(env); } catch (e) { return { ok: false, error: '사무실 기록을 열지 못했어요 (OFFICE_PASS 확인)' }; }
    } else {
      state = env;
    }
    if (!state || !Array.isArray(state.work)) return { ok: false, error: '사무실 기록 구조가 달라요' };

    const now = nowIso();
    const recKind = String(payload.kind || 'daily-brief');
    const existing = state.work.filter(function (w) { return w && w.kind === recKind; })[0] || null;
    let item;
    if (existing) {
      item = existing;
    } else {
      state.seq = (Number(state.seq) || 0) + 1;
      item = { id: 'w' + state.seq, teamId: 'research', materialIds: [], parentId: '', log: [], at: now, secretary: null, code: null, error: '' };
      state.work.push(item);
    }
    item.kind = recKind;
    item.briefDate = payload.date;
    item.title = clip(payload.titleOverride || ('📰 금융권 DBA 데일리 브리핑 · ' + payload.date), 80);
    item.brief = payload.brief;
    item.status = 'done';
    item.updatedAt = now;
    item.doneAt = now;
    item.nextDone = true;
    item.nextAt = now;
    item.report = payload.report;
    const logs = (payload.logs || []).map(function (t) { return { at: now, text: clip(t, 200) }; });
    item.log = logs.slice(-12);
    item.progressLog = logs.slice(-40);
    state.at = now;

    let text;
    if (env && env.ct && env.iv) text = JSON.stringify(await familyEncrypt(state), null, 2) + '\n';
    else text = JSON.stringify(state, null, 2) + '\n';

    const put = await ghWrite(P_OFFICE, text, r.sha || undefined, 'dba-research: ' + payload.date + ' 리서치팀 완료 기록');
    if (put.ok) return { ok: true, id: item.id, updated: !!existing };
    if (put.status === 409 || put.status === 422) {
      warn('사무실 기록 충돌 · 최신본을 다시 읽어 합칩니다 (' + (attempt + 1) + '/4)');
      await sleep(1200 * (attempt + 1));
      continue;
    }
    return { ok: false, error: put.error || ('HTTP ' + put.status) };
  }
  return { ok: false, error: '사무실 기록을 4번 시도해도 저장하지 못했어요(충돌)' };
}

/* ==================================================================
   메인
   ================================================================== */
async function main() {
  const t0 = Date.now();
  log('시작 · ' + NOW_LABEL + ' · 대상 ' + TODAY + (DRY ? ' · (미리보기)' : ''));

  /* 1) 수집 — 최근 7일 브리핑에 실린 기사는 먼저 추려 둔다 */
  const covered = await loadCovered7();
  const collected = await collectAll(covered);
  if (collected.skipped) log('7일 중복 제외 · ' + collected.skipped + '건');
  const prevUrls = await loadPreviousUrls();
  let prevCount = 0;
  for (const it of collected.items) { if (prevUrls[normUrl(it.url)]) { it.seen = true; prevCount++; } }
  log('수집 완료 · 기사 ' + collected.items.length + '건 (전체 ' + collected.total + ') · ' + Math.round(collected.ms / 100) / 10 + '초' + (prevCount ? ' · 어제 다룬 기사 ' + prevCount + '건' : ''));
  if (collected.versions && collected.versions.length) log('지원 버전 정보 · ' + collected.versions.length + '건 (endoflife.date)');
  for (const f of collected.feedStats) {
    log('  ' + (f.count ? '✓' : '·') + ' ' + f.name + ' ' + f.count + (f.error ? ' (' + clip(f.error, 90) + ')' : ''));
  }
  if (collected.items.length < 3) {
    console.log('::error::수집된 기사가 3건 미만이라 오늘 브리핑을 만들지 않습니다.');
    process.exit(1);
  }
  if (DUMP) {
    const p = writeLocal(DUMP, JSON.stringify({ date: TODAY, at: nowIso(), feedStats: collected.feedStats, items: collected.items }, null, 1));
    log('수집 결과 저장 · ' + p);
  }
  if (DRY || NO_AI) {
    log('미리보기 모드 · 프롬프트만 확인하고 끝냅니다 (AI 호출·저장 없음)');
    const prompt = buildUserPrompt(collected.items, collected.feedStats);
    log('프롬프트 길이 · ' + prompt.length + '자');
    console.log('----- 프롬프트 앞부분 -----');
    console.log(prompt.slice(0, 2500));
    console.log('----- 끝 -----');
    if (!DRY) return 0;
    return 0;
  }

  /* 2) 키 */
  if (!PASS) {
    console.log('::error::OFFICE_PASS 가 없어 암호화된 키를 열 수 없습니다.');
    return 1;
  }
  const loaded = await loadKeys();
  log('키 · openrouter ' + loaded.keys.openrouter.length + ' / groq ' + loaded.keys.groq.length + ' / gemini ' + loaded.keys.gemini.length + ' (from ' + (loaded.sources.join(', ') || '없음') + ')');
  if (!loaded.keys.openrouter.length && !loaded.keys.groq.length && !loaded.keys.gemini.length) {
    console.log('::error::AI 키가 하나도 없습니다(config/ai.json).');
    return 1;
  }

  /* 3) 요약 */
  const system = buildSystemPrompt();
  const user = buildUserPrompt(collected.items, collected.feedStats);
  const ai = await runAi(loaded.keys, system, user, collected.items);
  if (!ai.ok) {
    /* AI 가 모두 실패해도 그날 수집한 기사 목록은 남긴다(지어낸 요약 없이 원문 링크만). */
    console.log('::warning::AI 요약에 모두 실패해 기사 목록만 저장합니다 · ' + (ai.attempts || []).join(' | '));
    const feedOnly = {
      schema: 'dba-daily-brief/1', date: TODAY, weekday: kstParts(new Date(TODAY + 'T00:00:00+09:00')).weekday,
      generatedAt: nowIso(), timezone: 'Asia/Seoul', status: 'feed-only',
      error: (ai.attempts || []).join(' | '),
      audience: '증권사(금융권) Oracle·MySQL DBA · 2027-01-11 복귀 예정',
      headline: [], sections: [], actions: [], watch: [], sources: [],
      items: collected.items.slice(0, 16).map(function (it) {
        return { ref: it.ref, title: it.title, url: it.url, source: it.source, published: it.published || '', summary: it.snippet || '' };
      }),
      versions: collected.versions || [],
      collected: { total: collected.total, picked: collected.items.length, feeds: collected.feedStats },
      elapsedSec: Math.round((Date.now() - t0) / 1000)
    };
    const txt = JSON.stringify(feedOnly, null, 2) + '\n';
    if (!DRY) {
      writeLocal(P_OUT_DIR + '/' + TODAY + '.json', txt);
      writeLocal(P_OUT_DIR + '/latest.json', txt);
    }
    if (!DRY && !NO_OFFICE) {
      const rec = await upsertOfficeRecord({
        date: TODAY,
        titleOverride: '📰 금융권 DBA 리서치 · ' + TODAY + ' (수집만)',
        brief: 'AI 요약이 실패해 공개 피드에서 모은 기사 목록만 남겼습니다. 링크는 실제 수집된 원문입니다.',
        report: {
          summary: 'AI 요약 실패 · 기사 ' + collected.items.length + '건 수집만 완료',
          detail: trunc('AI 호출이 모두 실패했습니다.\n' + (ai.attempts || []).join('\n') + '\n\n[수집 기사]\n'
            + collected.items.slice(0, 12).map(function (it) { return '· ' + it.title + ' — ' + it.url; }).join('\n'), 3500),
          next: [{ label: 'AI 키·한도 확인 후 수동 실행', teamId: '' }], verdict: '', at: nowIso()
        },
        logs: ['수집 기사 ' + collected.items.length + '건', 'AI 실패 · 기사 목록만 저장']
      });
      if (!rec.ok) warn('사무실 기록 실패 · ' + rec.error);
    }
    return 0;
  }
  const brief = ai.brief;
  const used = ai.provider.label + ' · ' + ai.model;
  log('요약 완료 · ' + used + ' · 섹션 ' + brief.totalSections + '개 · 참조 기사 ' + brief.used.length + '건 · ' + Math.round(ai.ms / 100) / 10 + '초');

  /* 4) 저장 파일 */
  const out = {
    schema: 'dba-daily-brief/1',
    date: TODAY,
    weekday: kstParts(new Date(TODAY + 'T00:00:00+09:00')).weekday,
    generatedAt: nowIso(),
    timezone: 'Asia/Seoul',
    status: 'ok',
    model: used,
    audience: '증권사(금융권) Oracle·MySQL DBA · 2027-01-11 복귀 예정',
    headline: brief.headline,
    sections: brief.sections,
    actions: brief.actions,
    watch: brief.watch,
    sources: brief.used,
    versions: collected.versions || [],
    collected: {
      total: collected.total,
      picked: collected.items.length,
      feeds: collected.feedStats
    },
    promptChars: user.length,
    elapsedSec: Math.round((Date.now() - t0) / 1000)
  };
  const json = JSON.stringify(out, null, 2) + '\n';

  const datedPath = P_OUT_DIR + '/' + TODAY + '.json';
  if (DRY) {
    log('미리보기 · 파일을 쓰지 않습니다. 결과 미리보기:');
    console.log(json.slice(0, 3000));
    return 0;
  }
  writeLocal(datedPath, json);
  writeLocal(P_OUT_DIR + '/latest.json', json);
  log('저장 · ' + datedPath + ' · ' + P_OUT_DIR + '/latest.json (' + json.length + 'B)');

  /* 5) 사무실 기록 */
  if (!NO_OFFICE) {
    const report = {
      summary: clip((brief.headline[0] || '금융권 DBA 데일리 브리핑') , 120),
      detail: trunc(briefToText(brief, TODAY), 3500),
      next: [{ label: 'latest.json 확인 · 필요하면 피클에게 후속 정리 요청', teamId: '' }],
      verdict: '',
      at: nowIso()
    };
    const rec = await upsertOfficeRecord({
      date: TODAY,
      title: '📰 금융권 DBA 데일리 브리핑 · ' + TODAY,
      brief: '매일 09:40 KST 에 자동 실행되는 리서치팀 데일리 브리핑입니다. 공개 피드에서 모은 기사 '
        + collected.items.length + '건을 근거로 MySQL·Oracle·PostgreSQL 운영, 보안 CVE, 금융권 규제, 온프레미스 LLM 소식을 정리했습니다.',
      report: report,
      logs: [
        '수집 기사 ' + collected.items.length + '건 / 피드 ' + collected.feedStats.filter(function (f) { return f.count > 0; }).length + '개',
        '요약 모델 ' + used,
        '브리핑 저장 · ' + datedPath
      ]
    });
    if (rec.ok) log('사무실 기록 · ' + rec.id + (rec.updated ? ' (갱신)' : ' (새로 만듦)'));
    else warn('사무실 기록 실패 · ' + rec.error);
  }

  /* 6) 주간 요약 — 매주 월요일(Asia/Seoul) 또는 --weekly */
  if (kstParts().weekday === '월' || flag('weekly')) {
    if (flag('no-weekly')) log('주간 요약 · --no-weekly 로 건너뜁니다.');
    else await makeWeekly(loaded.keys);
  }

  log('끝 · ' + Math.round((Date.now() - t0) / 1000) + '초');
  return 0;
}

main().then(function (code) { process.exit(code || 0); }).catch(function (e) {
  console.log('::error::' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
