#!/usr/bin/env bash
# plan-lib.sh — helpers shared by the tests that run «install.sh --plan» in throwaway HOMEs (sourced after lib.sh).
# The caller sets T (a temp dir) and B (a bundle made by make_bundle) first.
N=0
# new_home → H (fresh empty HOME) · mk_setup <file> <python statements on d> → a setup.json (full mode · 2 bots · Slack on · playwright)
new_home() { N=$((N + 1)); H="$T/h$N"; mkdir -p "$H"; }
mk_setup() {
  python3 -I - "$1" "$H" "${2:-}" <<'PY'
import json, sys
f, h, extra = sys.argv[1], sys.argv[2], sys.argv[3]
d = {'schema': 1, 'mode': 'full', 'mux': 'auto',
     'slack': {'enabled': True, 'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'guests': []},
     'wiki': {'path': None}, 'mcp': [], 'codex': False, 'doctor': True, 'browser': 'playwright', 'memory': 'later',
     'bots': [{'name': 'lead', 'role': 'lead', 'work_dir': h + '/bots/lead', 'source': 'role-default', 'persona_dir': h + '/bots/lead'},
              {'name': 'watch', 'role': 'watch', 'work_dir': h + '/bots/watch', 'source': 'role-default', 'persona_dir': h + '/bots/watch'}],
     'import': {'from': [], 'to': None}}
exec(extra)
json.dump(d, open(f, 'w'), indent=2, ensure_ascii=False)
PY
}
# plan_run <setup file> [install args…] → OUT (stdout+stderr) · RC     (SHELL=zsh like a mac)
plan_run() {
  local f="$1"; shift
  OUT="$(env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm --plan "$f" "$@" 2>&1)"; RC=$?
}
# cfg «python expr on d» → value from ~/.slackmod/config.json · hjs <bot> «expr» → from that bot's harness.json
cfg() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$H/.slackmod/config.json" "$1"; }
hjs() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$H/.slackmod/bots/$1/harness.json" "$2"; }
count0() { printf '%s' "$1" | grep -o '바뀜 [0-9]*' | tail -1; }
