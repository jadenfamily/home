#!/usr/bin/env bash
# 📰 금융권 DBA 데일리 리서치 실행 → 커밋 → 푸시
#
# 위치: 공개 저장소 jadenfamily/home 의 office/scripts/run-dba-research.sh
# 호출: 데이터 저장소(jadenfamily/kids-dashboard-data)의
#       .github/workflows/daily-dba-research.yml 이
#         bash _home/office/scripts/run-dba-research.sh
#       로 부른다. (데이터 저장소 = 지금 폴더, 본체 스크립트 = _home 안)
#
# 이 셸이 하는 일
#  1) 본체(office/scripts/daily-dba-research.mjs)를 '지금 폴더(데이터 저장소 루트)'에서 실행한다.
#     → 스크립트의 ROOT 가 데이터 저장소 루트가 되어 ai-office/daily-dba-brief/ 에 파일을 쓴다.
#  2) 결과 파일(ai-office/daily-dba-brief/)을 커밋·푸시한다.
#     · 사무실 기록(ai-office/office-state.json)은 본체가 GitHub Contents API 로 직접 읽고·병합해
#       커밋하므로 여기서 다시 커밋하지 않는다(동시에 도는 일꾼 기록을 덮어쓰지 않기 위해서).
#       그래도 작업 폴더에 변경이 남아 있으면 함께 커밋한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MJS="$SCRIPT_DIR/daily-dba-research.mjs"
WORK_DIR="$(pwd)"

DRY="${DBA_DRY_RUN:-false}"
ARGS=()
if [ "$DRY" = "true" ]; then ARGS+=("--dry-run"); fi

if [ ! -f "$MJS" ]; then
  echo "::error::본체 스크립트를 찾지 못했어요: $MJS"
  exit 1
fi
if [ ! -d "$WORK_DIR/ai-office" ]; then
  echo "::error::데이터 저장소(kids-dashboard-data) 루트에서 실행해야 해요. 지금 폴더: $WORK_DIR"
  exit 1
fi
cd "$WORK_DIR"

echo "본체 · $MJS"
echo "작업 폴더 · $WORK_DIR (미리보기: $DRY)"
node --version
node "$MJS" "${ARGS[@]+"${ARGS[@]}"}"

if [ "$DRY" = "true" ]; then
  echo "미리보기 실행이라 커밋하지 않습니다."
  exit 0
fi

OUT_DIR="ai-office/daily-dba-brief"
STATE_FILE="ai-office/office-state.json"
if [ ! -d "$OUT_DIR" ]; then
  echo "브리핑 폴더가 없어 끝냅니다(스크립트가 저장하지 못했을 수 있어요)."
  exit 0
fi

STATE_CHANGED=0
if ! git diff --quiet -- "$STATE_FILE"; then STATE_CHANGED=1; fi

git config user.name "jadenfamily-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$OUT_DIR"
if [ "$STATE_CHANGED" = "1" ]; then git add "$STATE_FILE"; fi
if git diff --cached --quiet; then
  echo "새로 커밋할 브리핑이 없습니다."
  exit 0
fi

DATE="$(date -u -d '+9 hours' +%Y-%m-%d)"
git commit -m "dba-research: ${DATE} 금융권 DBA 데일리 브리핑 (auto-0940)"

# 다른 워크플로(날씨·백업·AI 사무실)와 동시에 푸시할 수 있어, 실패하면
# 원격 기준으로 다시 받아 브리핑 파일만 되살려 재시도한다.
# (office-state.json 은 본체가 API 로 직접 병합해 저장하므로 여기서 되살리지 않는다.)
TMPD="${RUNNER_TEMP:-/tmp}"
rm -rf "$TMPD/dba-brief" && mkdir -p "$TMPD/dba-brief"
cp -r "$OUT_DIR"/. "$TMPD/dba-brief"/

for i in 1 2 3; do
  if git pull --rebase --autostash origin main && git push; then
    echo "푸시 완료 ($i/3)"
    exit 0
  fi
  echo "동기화/푸시 실패 — 원격 기준으로 다시 시도합니다 ($i/3)"
  git rebase --abort 2>/dev/null || true
  git fetch origin main
  git reset --hard origin/main
  mkdir -p "$OUT_DIR"
  cp -r "$TMPD/dba-brief"/. "$OUT_DIR"/
  git add "$OUT_DIR"
  if git diff --cached --quiet; then
    echo "원격에 이미 같은 브리핑이 있어 커밋하지 않습니다."
    exit 0
  fi
  git commit -m "dba-research: ${DATE} 금융권 DBA 데일리 브리핑 (auto-0940)"
done
echo "::error::3회 재시도 후에도 브리핑을 푸시하지 못했습니다."
exit 1
