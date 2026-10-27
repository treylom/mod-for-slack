#!/usr/bin/env bash
# optional.sh — run one of the tools another part of the kit provides, or say it is not there yet.
#   bash optional.sh persona-check <bot folder> [more args]     → python3 -I persona-check.py … (rc 0 passed · 1 problems · 2 usage)
#   bash optional.sh persona-fill --answers FILE [more args]    → python3 -I persona-fill.py …
#   bash optional.sh doctor [--strict]                          → bash doctor.sh …
# When the tool's file is not next to this script: prints «건너뜀(아직 없음) <name>» and exits 0 (the wizard shows that cell as
# skipped — it never fakes a pass). Otherwise it runs the tool and passes its output and exit code through unchanged.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
NAME="${1:-}"; [ -n "$NAME" ] && shift || { sed -n 2,7p "$0" >&2; exit 2; }
case "$NAME" in
  persona-check|persona-fill) FILE="$HERE/$NAME.py"; RUN=(python3 -I "$FILE") ;;
  doctor) FILE="$HERE/doctor.sh"; RUN=(bash "$FILE") ;;
  *) echo "모르는 도구: $NAME (persona-check · persona-fill · doctor)" >&2; exit 2 ;;
esac
if [ ! -f "$FILE" ]; then echo "건너뜀(아직 없음) $NAME — $(basename "$FILE") 가 이 설치본에 아직 없습니다"; exit 0; fi
if [ "$NAME" != doctor ] && ! command -v python3 >/dev/null 2>&1; then echo "python3 가 없어 $NAME 을 못 돌립니다" >&2; exit 2; fi
exec "${RUN[@]}" "$@"
