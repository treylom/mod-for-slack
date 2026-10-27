#!/usr/bin/env bash
# role-default.sh — copy a role's starter files (setup/templates/roles/<role>/ : CLAUDE.md + persona.md) into a bot folder.
#   bash role-default.sh <role> <bot-folder> [--templates DIR] [--dry-run]
# Used when there is no earlier bot to carry over (roles: lead · watch · research). Never overwrites: a file that is already
# in the bot folder stays (same bytes = «그대로» · different = «안 덮음»). If the role has no starter folder (yet) it says
# «건너뜀(틀 없음)» and does nothing — it never makes a starter up. rc 0 ok / skipped · 2 input problem.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TEMPLATES="$HERE/../templates/roles"
DRY=0
ROLE=""; DEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --templates) TEMPLATES="${2:?--templates DIR}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,6p "$0"; exit 0 ;;
    -*) echo "모르는 옵션: $1" >&2; exit 2 ;;
    *) if [ -z "$ROLE" ]; then ROLE="$1"; elif [ -z "$DEST" ]; then DEST="$1"; else echo "인자가 너무 많습니다" >&2; exit 2; fi; shift ;;
  esac
done
[ -n "$ROLE" ] && [ -n "$DEST" ] || { echo "쓰는 법: role-default.sh <역할> <봇 폴더> [--dry-run]" >&2; exit 2; }
printf '%s' "$ROLE" | grep -qE '^[a-z][a-z0-9-]{0,31}$' || { echo "역할 이름은 소문자 영문으로 시작, 소문자·숫자·- 만: $ROLE" >&2; exit 2; }
case "$DEST" in /*) ;; *) echo "봇 폴더는 절대 경로여야 합니다: $DEST" >&2; exit 2 ;; esac
SRC="$TEMPLATES/$ROLE"
if [ ! -d "$SRC" ] || [ -z "$(ls -A "$SRC" 2>/dev/null)" ]; then
  echo "건너뜀(틀 없음) $ROLE — $SRC 가 없거나 비어 있습니다. 봇 폴더는 그대로 두었습니다."
  exit 0
fi
COPIED=0; SAME=0; KEPT=0
while IFS= read -r f; do
  rel="${f#"$SRC"/}"
  dst="$DEST/$rel"
  if [ -e "$dst" ]; then
    if cmp -s "$f" "$dst"; then SAME=$((SAME + 1)); else KEPT=$((KEPT + 1)); echo "안 덮음 $dst (이미 다른 파일이 있음)"; fi
    continue
  fi
  COPIED=$((COPIED + 1))
  if [ "$DRY" = 1 ]; then echo "할 일 $ROLE/$rel → $dst"; else
    mkdir -p "$(dirname "$dst")"
    tmp="$(mktemp "$dst.slackmod-tmp.XXXXXX")"   # a fresh file, never a name planted beforehand (a repo can commit a link)
    cp "$f" "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$dst"
    echo "복사 $ROLE/$rel → $dst"
  fi
done < <(find "$SRC" -type f ! -name '.DS_Store' | LC_ALL=C sort)
echo "결과: 복사 $COPIED · 그대로 $SAME · 안 덮음 $KEPT$( [ "$DRY" = 1 ] && echo ' (미리 보기 — 아무것도 안 씀)')"
