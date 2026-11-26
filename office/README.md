# AI 사무실 — office.html 모듈 구조

`office.html` 은 화면 뼈대(HTML 셸)만 담고, 스타일과 코드는 기능별 파일로 나뉘어 있어요.
아이 화면(`kids-dashboard`)과 같은 방식이라, 고칠 때는 해당 모듈 파일만 열면 돼요.

```
office.html            화면 뼈대 + css/js 불러오기 (24개 모듈 순서대로)
office/css/style.css   사무실·결재함·접수함·잠금 화면·모달·모바일 탭 스타일
office/js/             기능별 코드 (모두 같은 전역 스코프를 써요)
```

## 모듈 지도 (불러오는 순서)

| 파일 | 맡은 일 |
| --- | --- |
| `state.js` | 상수 · 저장 위치 · 열쇠 이름 · 앱 상태(S) |
| `util.js` | 공통 도구(문자·시간·해시·base64·토스트) · 저장소 이름/경로 다듬기 |
| `sync.js` | 기기 연결 · 로그인 세션 · GitHub Contents API · 파일 캐시 |
| `crypto.js` | 가족 공유 AI 설정 암호화(AES-GCM·PBKDF2) · 대화 잠금 열쇠 |
| `qr.js` | 2차 인증 등록용 QR 코드 |
| `totp.js` | 2차 인증(구글 인증 앱 6자리) |
| `webauthn.js` | Face ID · 지문 · 등록된 기기 |
| `keys.js` | AI 키 · AI 설정 · 계정 확인 |
| `providers.js` | 제공자·모델 목록 · 호출 · 한도 · 키 순환 |
| `tools.js` | AI가 쓰는 도구 목록 · 가족 데이터 읽기 · 찾아 바꾸기 |
| `toolcalls.js` | 도구 스키마 · 도구 호출 해석 |
| `codecheck.js` | 수정안 자동 검사 · 줄 비교(diff) |
| `office-data.js` | 사무실 데이터 — 팀 · 일 · 보고 · 결재 · 접수함 |
| `worker.js` | 백그라운드 일꾼 연동 — 자동 중단 · 다시 실행 · 삭제 |
| `ai.js` | 팀 지시문(공통 규칙 5가지 포함) · AI 호출 · 팀 보고 해석 |
| `secretary.js` | 1F 비서실(피클) — 배분 계획 → 승인 → 팀 순차 실행 → 취합 보고 |
| `approval.js` | 결재 · 다음 단계 · 반려 · 넘기기 |
| `ui.js` | 화면 — 층 안내 · 사무실 · 팀 카드 · 결재함 · 접수함 |
| `team-modal.js` | 팀 작업 현황 모달 |
| `detail.js` | 업무 자세히 보기 모달(최근 마무리 클릭) |
| `gate.js` | 잠금 화면 · 자동 잠금 |
| `settings.js` | 설정 모달 — 키 · 모델 · 팀 · 자동 잠금 |
| `events.js` | 이벤트 위임(제출·입력·변경·클릭·키보드) |
| `boot.js` | 시작 — 환경 설정 불러오기 · 첫 렌더 · 1초 틱 |

## 고칠 때

- 함수 이름은 사무실 전체에서 하나예요. 새 함수를 넣을 때 같은 이름이 있는지 먼저 확인해요.
- `office.html` 에서 모듈 순서를 바꾸면 정의보다 사용이 먼저 일어날 수 있어요. 새 모듈은 `boot.js` 앞에 넣어요.
- 테스트 서버(`/workspace/home`) 사본은 `python3 office-build/build.py` 로 다시 복사해요.
