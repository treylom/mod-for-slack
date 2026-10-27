#!/usr/bin/env bash
# detect.sh — READ ONLY scan of what could be carried over from other agent setups on this computer.
#   bash detect.sh [--home DIR]      JSON on stdout: {"home", "count", "items":[{id, kind, label, path, detail, files}], "skipped":[…]}
# Looks at: ~/.claude (CLAUDE.md · agents · skills · settings.json allow lists · channels/*/*.md persona files) · ~/.codex (AGENTS.md ·
# config.toml) · an earlier ~/.slackmod/config.json and its bots. Nothing is written and nothing secret is printed
# (settings: only the number of allow / deny / ask entries). The item ids go into setup.json import.from — see detect_import.py.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
command -v python3 >/dev/null 2>&1 || { echo "python3 가 필요합니다" >&2; exit 2; }
exec python3 -I "$HERE/detect_import.py" detect "$@"
