#!/usr/bin/env bash
# m4-effort.sh — «생각 깊이» per bot: setup.json bots[].effort → config → launch.sh SM_EFFORT → the bot window's --effort ·
# «slackmod set-effort» / «slackmod effort».
#   ① effort high for one bot → its launch.sh has SM_EFFORT=high right after SM_MODEL · the other bot (no effort) has no such line
#   ② no effort anywhere → plan() = the golden bytes (setup/tests/golden/plan-base.json) · with effort the only difference is that one line
#   ③ «slackmod _print-main» → «--effort high» for that bot · none for the other · a SM_EFFORT in the caller's environment is not taken
#   ④ set-effort all medium → config.json and ~/.slackmod/setup.json both medium · launch.sh remade (SM_EFFORT=medium both) ·
#      «다음 켜기부터 적용» · «slackmod effort» lists both · set-effort <bot> default → key gone, no line
#   ⑤ wrong value / unknown bot / missing words → rc ≠ 0 and config · setup.json unchanged
#   ⑥ set-effort then «slackmod undo --yes» → the whole effort change goes back (config · setup.json · launch.sh), the first
#      install stays
#   bash setup/tests/m4-effort.sh          rc 0 = all PASS (throwaway HOMEs only)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m4-effort)"
trap 'rm -rf "$T"' EXIT
B="$T/bundle"; make_bundle "$B"
cp "$PORT_DIR/lib/record.py" "$B/lib/"; cp -R "$PORT_DIR/templates/starter-wiki" "$B/templates/"
. "$SETUP_TESTS_DIR/plan-lib.sh"
inst() { local f="$1"; shift; OUT="$( export SHELL=/bin/zsh HOME="$H"; "$BASHX" "$B/install.sh" --no-npm --plan "$f" "$@" 2>&1 )"; RC=$?; }
sm() { OUT="$( export HOME="$H"; "$BASHX" "$H/.slackmod/bin/slackmod" "$@" 2>&1 )"; RC=$?; }
sjs() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$H/.slackmod/setup.json" "$1"; }
lines_after_model() { sed -n '/^SM_MODEL=/{n;p;}' "$H/.slackmod/bots/$1/launch.sh"; }

# ① setup.json effort → launch.sh
new_home; mk_setup "$H/.slackmod-setup.json" "d['bots'][0]['effort'] = 'high'"
mkdir -p "$H/.slackmod"; mv "$H/.slackmod-setup.json" "$H/.slackmod/setup.json"
inst "$H/.slackmod/setup.json"
[ $RC -eq 0 ] && [ "$(lines_after_model lead)" = "SM_EFFORT=high" ] && [ "$(grep -c '^SM_EFFORT=' "$H/.slackmod/bots/watch/launch.sh")" = 0 ] \
  && [ "$(cfg "d['bots'][0].get('effort')")" = high ] && [ "$(cfg "'effort' in d['bots'][1]")" = False ] \
  && ok "① effort high (lead) → config bots[0].effort high · lead launch.sh SM_EFFORT=high right after SM_MODEL · watch: no SM_EFFORT line, no config key" \
  || { no "① rc=$RC after-model=$(lines_after_model lead)"; printf '%s\n' "$OUT" | tail -4; }

# ② golden bytes without effort · exactly one line more with it
python3 -I - "$PORT_DIR/lib/slackmod_config.py" "$SETUP_TESTS_DIR/golden/plan-base.json" <<'PY'
import copy, importlib.util, json, os, sys
sys.dont_write_bytecode = True
os.environ['HOME'] = '/h'
spec = importlib.util.spec_from_file_location('cfgmod', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
BASE = {'schema': 1,
        'slack': {'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'drop_notice': True, 'drop_notice_no_mention': True},
        'bots': [{'name': 'lead', 'work_dir': '/w/lead', 'slack_bot_user_id': 'UTESTBOT001', 'model': ''},
                 {'name': 'watch', 'work_dir': '/w/watch', 'slack_bot_user_id': 'UTESTBOT002', 'model': 'opus'}],
        'aliases': {'all': 'allbots', 'all_stop': 'allbots-stop'}, 'permission': 'skip',
        'child': {'model': 'sonnet', 'effort': 'medium', 'min_disk_free_gb': 20, 'min_free_mem_pct': 15}}
def plan_of(c): return m.plan(c, '/r', '/py', '/node', '/claude', '/bin/sh', '0' * 64)
fail = 0
got = json.dumps(plan_of(copy.deepcopy(BASE)), indent=2, ensure_ascii=False, sort_keys=True) + '\n'
same = got == open(sys.argv[2], encoding='utf-8').read()
c = copy.deepcopy(BASE); c['bots'][1]['effort'] = 'max'
def launch(p, bot): return [f['content'] for f in p['files'] if f['path'] == '/r/bots/%s/launch.sh' % bot][0].split('\n')
a, b = launch(plan_of(copy.deepcopy(BASE)), 'watch'), launch(plan_of(c), 'watch')
one = b[:4] + b[5:] == a and b[4] == 'SM_EFFORT=max' and b[3] == 'SM_MODEL=opus'
print(('PASS' if same else 'FAIL') + ' ②a no effort → plan() is byte-for-byte the golden (plan-base.json)')
print(('PASS' if one else 'FAIL') + ' ②b effort max → watch launch.sh = the golden one + «SM_EFFORT=max» after SM_MODEL (nothing else moves)')
sys.exit(0 if same and one else 1)
PY
[ $? -eq 0 ] || FAIL=1

# ③ the bot window's command line
sm _print-main lead; PL="$OUT"; PLR=$RC
sm _print-main watch; PW="$OUT"
PX="$( export HOME="$H" SM_EFFORT=max; "$BASHX" "$H/.slackmod/bin/slackmod" _print-main watch 2>&1 )"
[ $PLR -eq 0 ] && printf '%s' "$PL" | grep -q -- ' --effort high' && ! printf '%s' "$PW" | grep -q -- '--effort' && ! printf '%s' "$PX" | grep -q -- '--effort' \
  && printf '%s' "$PW" | grep -q -- '--dangerously-skip-permissions' \
  && ok "③ _print-main: lead → «--effort high» · watch → no --effort (bait: its other flags are there) · SM_EFFORT=max in the caller's environment → still none" \
  || { no "③ print-main rc=$PLR"; printf '%s\n' "$PL" | tail -3; }

# ④ set-effort all medium → config + setup.json + launch.sh remade
sm set-effort all medium
[ $RC -eq 0 ] && [ "$(cfg "[b.get('effort') for b in d['bots']]")" = "['medium', 'medium']" ] && [ "$(sjs "[b.get('effort') for b in d['bots']]")" = "['medium', 'medium']" ] \
  && [ "$(lines_after_model lead)" = "SM_EFFORT=medium" ] && [ "$(lines_after_model watch)" = "SM_EFFORT=medium" ] \
  && printf '%s' "$OUT" | grep -q '다음 켜기부터 적용 — slackmod stop <봇> → slackmod start <봇>' && printf '%s' "$OUT" | grep -q '^결과: ' \
  && ok "④a set-effort all medium → config.json + setup.json both medium · both launch.sh SM_EFFORT=medium (installer run again) · «다음 켜기부터 적용»" \
  || { no "④a rc=$RC cfg $(cfg "[b.get('effort') for b in d['bots']]") setup $(sjs "[b.get('effort') for b in d['bots']]")"; printf '%s\n' "$OUT" | tail -5; }
sm effort
[ $RC -eq 0 ] && printf '%s\n' "$OUT" | grep -qE '^lead +medium$' && printf '%s\n' "$OUT" | grep -qE '^watch +medium$' \
  && ok "④b «slackmod effort» → one line per bot (lead medium · watch medium)" || { no "④b rc=$RC"; printf '%s\n' "$OUT"; }
sm set-effort watch default
[ $RC -eq 0 ] && [ "$(cfg "'effort' in d['bots'][1]")" = False ] && [ "$(sjs "d['bots'][1]['effort']")" = "" ] && [ "$(grep -c '^SM_EFFORT=' "$H/.slackmod/bots/watch/launch.sh")" = 0 ] \
  && [ "$(lines_after_model lead)" = "SM_EFFORT=medium" ] && sm effort && printf '%s\n' "$OUT" | grep -qE '^watch +\(기본\)$' \
  && ok "④c set-effort watch default → config key removed · setup.json effort '' · watch launch.sh has no SM_EFFORT line · lead untouched · effort shows «(기본)»" \
  || { no "④c rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑤ wrong input changes nothing
C0="$(sha_of "$H/.slackmod/config.json")"; S0="$(sha_of "$H/.slackmod/setup.json")"
sm set-effort lead turbo; R1=$RC; O1="$OUT"
sm set-effort nobody high; R2=$RC; O2="$OUT"
sm set-effort lead; R3=$RC
[ $R1 -ne 0 ] && [ $R2 -ne 0 ] && [ $R3 -ne 0 ] && [ "$(sha_of "$H/.slackmod/config.json")" = "$C0" ] && [ "$(sha_of "$H/.slackmod/setup.json")" = "$S0" ] \
  && printf '%s' "$O1" | grep -q '아무것도 바꾸지 않았습니다' && printf '%s' "$O2" | grep -q '모르는 봇: nobody' \
  && ok "⑤ set-effort lead turbo (rc $R1) · unknown bot (rc $R2) · missing value (rc $R3) → config.json and setup.json unchanged" \
  || no "⑤ rc $R1/$R2/$R3 · $O1 · $O2"

# ⑥ «undo» right after set-effort takes back the whole effort change (config · setup.json · launch.sh) and nothing of the first install
eff_listing() { listing "$H" | grep -v -E '^\./\.slackmod/(state|backup)(/|$| )'; }
new_home; mk_setup "$H/.slackmod-setup.json"
mkdir -p "$H/.slackmod"; mv "$H/.slackmod-setup.json" "$H/.slackmod/setup.json"
inst "$H/.slackmod/setup.json"
L6="$(eff_listing)"; C6="$(sha_of "$H/.slackmod/config.json")"; S6="$(sha_of "$H/.slackmod/setup.json")"
sm set-effort all high; E6=$RC; EO6="$OUT"
H6="$(grep -c '^SM_EFFORT=high' "$H/.slackmod/bots/lead/launch.sh")"
sm undo --yes
[ $E6 -eq 0 ] && [ "$H6" = 1 ] && printf '%s' "$EO6" | grep -qF '되돌리면 방금 바꾼 생각 깊이만 돌아갑니다(처음 설치는 그대로)' \
  && [ $RC -eq 0 ] && [ "$(cfg "[('effort' in b) for b in d['bots']]")" = "[False, False]" ] \
  && [ "$(grep -c '^SM_EFFORT=' "$H/.slackmod/bots/lead/launch.sh")" = 0 ] && [ "$(grep -c '^SM_EFFORT=' "$H/.slackmod/bots/watch/launch.sh")" = 0 ] \
  && [ "$(sha_of "$H/.slackmod/config.json")" = "$C6" ] && [ "$(sha_of "$H/.slackmod/setup.json")" = "$S6" ] && [ "$(eff_listing)" = "$L6" ] \
  && [ -f "$H/.slackmod/bin/slackmod" ] \
  && ok "⑥ set-effort all high (launch.sh high · «되돌리면 방금 바꾼 생각 깊이만…») → undo --yes rc 0 · config effort keys 0 · launch.sh SM_EFFORT 0 · config/setup.json bytes back · first install kept (listing == after it)" \
  || { no "⑥ set-effort rc=$E6 high=$H6 undo rc=$RC cfg $(cfg "[b.get('effort') for b in d['bots']]")"; printf '%s\n' "$OUT" | tail -3; diff <(printf '%s\n' "$L6") <(eff_listing) | head -6; }
finish
