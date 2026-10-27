#!/usr/bin/env bash
# find-installer.sh — print the path of the installer body (the thing that does «install.sh --plan»).
#   bash find-installer.sh [REPO_ROOT]       (default REPO_ROOT = two levels above this file = the checkout that holds setup/)
# Order (one place, so the wizard never guesses): <root>/slackmod/install.sh (public layout · the bundle tree) →
# <root>/port/install.sh (development layout). rc 0 = path printed · 1 = neither exists (a message on stderr).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="${1:-$HERE/../..}"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P)" || { echo "저장소 폴더를 못 찾았습니다: ${1:-}" >&2; exit 1; }
for c in "$ROOT/slackmod/install.sh" "$ROOT/port/install.sh"; do
  if [ -f "$c" ]; then printf '%s\n' "$c"; exit 0; fi
done
echo "설치 본체를 못 찾았습니다 — $ROOT/slackmod/install.sh 도 $ROOT/port/install.sh 도 없습니다" >&2
exit 1
