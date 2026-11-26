/* ============================================================================
   AI 사무실 — office/js/state.js
   상수 · 저장 위치 · 열쇠 이름 · 앱 상태(S)
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* 🏢 AI 사무실 — 팀별 AI 직원에게 일을 맡기고, 비서(피클)의 정리 보고를 대표님이 결재해요.
   인증·키·코딩 엔진은 예전에 검증해 둔 chat.html 구현을 그대로 이어받았어요. */

/* ---------- 저장 위치 ---------- */
var API_BASE = 'https://api.github.com';
var DEFAULT_OWNER = 'jadenfamily';
var DEFAULT_REPO = 'kids-dashboard-data';
var P_OFFICE = 'ai-office/office-state.json';
var P_INBOX = 'ai-office/inbox.json';

/* /home·아이 대시보드와 같은 열쇠를 써요 (같은 주소라서 로그인이 이어져요) */
var K_DEVICE = 'kidsDashboard.device.v1';
var K_USERS = 'kidsDashboard.users.v1';
var K_SHA = 'kidsDashboard.sha.v1';
var K_SESSION = 'kidsDashboard.session.v1';

/* 사무실에서만 쓰는 열쇠 */
var K_DEVID = 'kidsDashboard.chat.deviceId.v1';
var K_UNLOCK = 'kidsDashboard.chat.unlock.v1';
var K_LIMITS = 'kidsDashboard.chat.limits.v1';
var K_PREF = 'kidsDashboard.office.pref.v1';
var K_MODELS = 'kidsDashboard.chat.models.v1';
var K_DEAD = 'kidsDashboard.chat.deadModels.v1';
var K_KEYSTATE = 'kidsDashboard.chat.keyState.v1';
var K_TOTP_SEEN = 'kidsDashboard.chat.totp.v1';

/* Face ID / 생체인증 — chat.html에서 등록한 이 기기 기록을 그대로 써요 */
var K_BIO = 'jaden_chat_bio_v1_';
var K_BIO_WRAP = 'jaden_chat_bio_wrap_v1_';

var AUTO_LOCK_STEPS = [1, 3, 5, 10, 30, 0];
var AUTO_LOCK_DEFAULT = 10;

var CHAT_ITER = 150000;
var PATH_THREADS = 'ai-chat/';
var PATH_AI = 'config/ai.json';
var PATH_DEVICES = 'config/trusted-devices.json';

var TOTP_PERIOD = 30;
var TOTP_DIGITS = 6;
var TOTP_ITER = 100000;
var TOTP_ISSUER = 'jadenfamily';

var CODE_REPOS = ['home', 'kids-dashboard', 'fridge-dashboard', 'ledger-dashboard'];
var REPO_ALIAS = {
    'home': 'home', '허브': 'home', '홈': 'home', '사무실': 'home',
    'kids': 'kids-dashboard', 'kid': 'kids-dashboard', '아이': 'kids-dashboard',
    'fridge': 'fridge-dashboard', '냉파': 'fridge-dashboard', '냉장고': 'fridge-dashboard',
    'ledger': 'ledger-dashboard', '가계부': 'ledger-dashboard'
};
var PREFERRED_MODEL = { gemini: 'gemini-3.8-flash' };

var OFFICE_NAME = 'AI 사무실';

var S = {
    conn: null, users: null, me: null, sha: {}, deviceId: '', deviceName: '',
    unlocked: false, chatKey: null, chatSalt: null, chatIter: CHAT_ITER,
    loaded: false,
    ai: { gemini: '', openrouter: '', groq: '', codeToken: '', at: 0, present: false,
      keys: { gemini: [], openrouter: [], groq: [] }, active: { gemini: 0, openrouter: 0, groq: 0 } },
    keyLimit: {}, limits: {}, dead: {}, noTools: null, devices: [],
    pref: { model: '', instructions: '', autoLock: AUTO_LOCK_DEFAULT },
    totp: { ok: true, present: false, enabled: false, cfg: null }, totpSetup: null, totpMsg: '', totpOff: false,
    bioMsg: '', bioBusy: false, gateMode: '', gateAlt: false, gateBusy: false,
    pending: {}, proposals: {},
    office: null, officeLocked: false, officeState: '',
    inbox: { ok: false, items: [], error: '', at: 0 },
    tab: 'office', selTeam: 'cs',
    draft: { team: 'cs', title: '', text: '', material: '' },
    rejectOpen: {}, details: {},
    busy: {}, queue: [], running: false,
    teamModal: null, workModal: null, directHint: '',
    pipe: [], pipeRunning: false, planQueue: [], planRunning: false,
    saveTimer: null, saveChain: Promise.resolve(), saveState: 'idle',
    lastActivityAt: 0, settingsMsg: '',
    bg: { pollTimer: null, lastSha: '', kick: {}, at: 0, result: '', note: '',
      watch: {}, stopping: {}, notified: {}, watchAt: 0, liveAt: 0 }
};
