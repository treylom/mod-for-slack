#!/usr/bin/env bash
# import.sh — COPY the picked items of an earlier setup into the import folder and into the bots' project folders.
#   bash import.sh --from ID[,ID…] [--bot NAME:WORKDIR]… [--map ITEMID=NAME]… [--to DIR] [--home DIR] [--dry-run]
# Originals are only read (their sha256 are compared before and after — the last line says «원본 지문 전후: 같음»).
# Nothing is overwritten · secret-shaped files are refused · rc 0 ok · 2 input problem · 3 originals changed.
# Full contract (ids · where each pick goes · refusals): python3 detect_import.py --help
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v python3 >/dev/null 2>&1 || { echo "python3 가 필요합니다" >&2; exit 2; }
exec python3 -I "$HERE/detect_import.py" import "$@"
