#!/usr/bin/env bash
# m2-plugin-libs.sh — the plugin files and the two small libs:
#   ① plugin.json · commands/setup.md · skills/mods-setup/SKILL.md are well formed (claude plugin validate · frontmatter fields) and
#      the command is /mods-setup:setup with [--answers FILE] [--section NAME]
#   ② every setup/lib file the skill tells the model to run really exists (no drift) · the flow keeps its fixed parts
#      (3 modes · 9 columns · AskUserQuestion limit · «설치할까요?» once · no secrets asked · originals read-only)
#   ③ find-installer.sh: public layout → dev layout → neither (rc 1) ④ optional.sh: tool missing = «건너뜀(아직 없음)» rc 0 ·
#      tool present = output and exit code pass through unchanged · unknown tool rc 2
#   bash setup/tests/m2-plugin-libs.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m2-plug)"
trap 'rm -rf "$T"' EXIT
CMD="$SETUP_DIR/commands/setup.md"; SKILL="$SETUP_DIR/skills/mods-setup/SKILL.md"; PJ="$SETUP_DIR/.claude-plugin/plugin.json"

# ① structure
python3 -I - "$PJ" "$CMD" "$SKILL" <<'PY'
import json, re, sys
pj, cmd, skill = sys.argv[1:4]
fail = 0
def ok(t): print('PASS ' + t)
def no(t):
    global fail
    print('FAIL ' + t); fail = 1
m = json.load(open(pj))
(ok if m.get('name') == 'mods-setup' and re.fullmatch(r'\d+\.\d+\.\d+', m.get('version', '')) and m.get('description') else no)('plugin.json: name mods-setup · semver version · description')
def front(path):
    t = open(path, encoding='utf-8').read()
    mm = re.match(r'^---\n(.*?)\n---\n', t, re.S)
    d = {}
    if mm:
        for ln in mm.group(1).split('\n'):
            k, _, v = ln.partition(':')
            d[k.strip()] = v.strip()
    return d, t
d, t = front(cmd)
(ok if d.get('description') and d.get('argument-hint') == '[--answers FILE] [--section NAME]' and 'AskUserQuestion' in d.get('allowed-tools', '') and 'Bash' in d.get('allowed-tools', '') else no)('commands/setup.md: description · argument-hint [--answers FILE] [--section NAME] · allowed-tools has Bash + AskUserQuestion')
(ok if '$ARGUMENTS' in t and 'mods-setup:mods-setup' in t else no)('commands/setup.md: passes $ARGUMENTS · names the skill mods-setup:mods-setup')
d, t = front(skill)
(ok if d.get('name') == 'mods-setup' and 20 < len(d.get('description', '')) <= 1024 else no)('SKILL.md: name mods-setup · description present (≤ 1024 chars, got %d)' % len(d.get('description', '')))
sys.exit(fail)
PY
[ $? -eq 0 ] && PASSN=$((PASSN + 4)) || FAIL=1
env -i HOME="$T" PATH="$PATH" claude plugin validate "$SETUP_DIR" > "$T/validate.log" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q 'Validation passed' "$T/validate.log" && ok "claude plugin validate setup → passed (rc 0)" || { no "plugin validate rc=$rc"; tail -5 "$T/validate.log"; }
# ② the skill's references
missing=""
for f in $(grep -o '\$SETUP/lib/[A-Za-z0-9_.-]*' "$SKILL" | sed 's#\$SETUP/lib/##' | sort -u); do
  [ -f "$SETUP_DIR/lib/$f" ] || missing="$missing $f"
done
[ -z "$missing" ] && ok "SKILL.md: every \$SETUP/lib/<file> it names exists ($(grep -o '\$SETUP/lib/[A-Za-z0-9_.-]*' "$SKILL" | sort -u | wc -l | tr -d ' ') files)" || no "SKILL.md names files that do not exist:$missing"
miss2=""
for w in 'detect.sh' 'import.sh' 'plan.py' 'open-terminal.sh' 'find-installer.sh' 'optional.sh' 'role-default.sh'; do grep -q "$w" "$SKILL" || miss2="$miss2 $w"; done
[ -z "$miss2" ] && ok "SKILL.md uses all seven lib entry points (detect · import · plan · open-terminal · find-installer · optional · role-default)" || no "SKILL.md never mentions:$miss2"
miss3=""
for w in '빠른' '전체' '빈 판' '① 창 도구' '② Slack' '③ 위키' '④ MCP' '⑤ 코덱스' '⑥ 점검 스킬' '⑦ 브라우저' '⑧ 메모리' '⑨ 하위 세션 쓰기' '여는 말' 'children_open' '설치 검사기가 받지 않음' '⑨-1 하위 라우터' '동봉 판정기 쓰기' 'slackmod set-judge-key' '질문 4개 이하' '선택지 2~4개' '설치할까요' '토큰·비밀번호는 묻지도 받지도 않습니다' '읽기만' '원본 지문 전후' '--answers' '--section' 'install.sh --plan' '요약: OK n' 'MODS_SETUP_NO_OPEN'; do grep -q -- "$w" "$SKILL" || miss3="$miss3 [$w]"; done
[ -z "$miss3" ] && ok "SKILL.md keeps the fixed parts (3 modes · 9 columns · ≤4 questions × 2-4 choices · 설치할까요 · secrets never asked · read-only originals · fingerprint line · both args · --plan · summary line · no-open switch)" || no "SKILL.md lost:$miss3"
n="$(grep -c '설치할까요' "$SKILL")"
[ "$n" -ge 1 ] && ok "SKILL.md: the install confirmation question exists (mentioned ${n}×)" || no "no confirm"
! grep -qE 'xox[abp]-|xapp-|sk-[A-Za-z0-9]{10}' "$SKILL" "$CMD" && ok "plugin text holds no token-shaped string" || no "token-shaped text in plugin"
# ③ find-installer.sh
FI="$SETUP_DIR/lib/find-installer.sh"
mkdir -p "$T/pub/slackmod" "$T/dev/port" "$T/both/slackmod" "$T/both/port" "$T/none"
for d in pub/slackmod dev/port both/slackmod both/port; do : > "$T/$d/install.sh"; done
P_pub="$(cd "$T/pub" && pwd -P)"; P_dev="$(cd "$T/dev" && pwd -P)"; P_both="$(cd "$T/both" && pwd -P)"
o1="$("$BASHX" "$FI" "$T/pub" 2>&1)"; r1=$?; o2="$("$BASHX" "$FI" "$T/dev" 2>&1)"; r2=$?; o3="$("$BASHX" "$FI" "$T/both" 2>&1)"; r3=$?
o4="$("$BASHX" "$FI" "$T/none" 2>&1)"; r4=$?; o5="$("$BASHX" "$FI" "$T/nothere" 2>&1)"; r5=$?
[ $r1 -eq 0 ] && [ "$o1" = "$P_pub/slackmod/install.sh" ] && [ $r2 -eq 0 ] && [ "$o2" = "$P_dev/port/install.sh" ] && [ $r3 -eq 0 ] && [ "$o3" = "$P_both/slackmod/install.sh" ] \
  && ok "find-installer: public layout → <root>/slackmod/install.sh · dev layout → <root>/port/install.sh · both present → slackmod first" || no "find-installer layouts: $o1 | $o2 | $o3"
[ $r4 -eq 1 ] && printf '%s' "$o4" | grep -q '못 찾았습니다' && [ $r5 -eq 1 ] && ok "find-installer: neither → rc 1 + message · unknown folder → rc 1" || no "find-installer negatives rc $r4 $r5"
# default root = the checkout this file sits in (real repo: has port/install.sh or slackmod/install.sh)
o6="$("$BASHX" "$FI" 2>&1)"; r6=$?
[ $r6 -eq 0 ] && [ -f "$o6" ] && ok "find-installer without an argument → finds this checkout's installer ($(basename "$(dirname "$o6")")/install.sh)" || no "find-installer default rc=$r6 $o6"
# ④ optional.sh
OP="$SETUP_DIR/lib/optional.sh"
mkdir -p "$T/opt-missing" "$T/opt-present"; cp "$OP" "$T/opt-missing/optional.sh"; cp "$OP" "$T/opt-present/optional.sh"
for tool in persona-check persona-fill doctor; do
  out="$("$BASHX" "$T/opt-missing/optional.sh" "$tool" x 2>&1)"; rc=$?
  [ $rc -eq 0 ] && [ "$out" = "건너뜀(아직 없음) $tool — $( [ $tool = doctor ] && echo doctor.sh || echo $tool.py ) 가 이 설치본에 아직 없습니다" ] && ok "optional $tool (tool file absent): rc 0 · «건너뜀(아직 없음)»" || { no "optional $tool absent rc=$rc: $out"; }
done
printf 'import sys\nprint("fake persona-check args:", " ".join(sys.argv[1:]))\nsys.exit(1)\n' > "$T/opt-present/persona-check.py"
printf '#!/bin/bash\necho "fake doctor args: $*"\nexit 0\n' > "$T/opt-present/doctor.sh"
printf 'import sys\nprint("fake fill", sys.argv[1:])\nsys.exit(3)\n' > "$T/opt-present/persona-fill.py"
out="$("$BASHX" "$T/opt-present/optional.sh" persona-check /some/bot --skip required 2>&1)"; rc=$?
[ $rc -eq 1 ] && [ "$out" = "fake persona-check args: /some/bot --skip required" ] && ok "optional persona-check (present): output + exit code 1 pass through · args intact" || no "optional persona-check present rc=$rc: $out"
out="$("$BASHX" "$T/opt-present/optional.sh" doctor --strict 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$out" = "fake doctor args: --strict" ] && ok "optional doctor (present): passes --strict through · rc 0" || no "optional doctor present rc=$rc: $out"
out="$("$BASHX" "$T/opt-present/optional.sh" persona-fill --answers a.json 2>&1)"; rc=$?
[ $rc -eq 3 ] && printf '%s' "$out" | grep -q 'fake fill' && ok "optional persona-fill (present): exit code 3 passes through" || no "optional persona-fill present rc=$rc"
"$BASHX" "$OP" bogus > /dev/null 2>&1; r1=$?; "$BASHX" "$OP" > /dev/null 2>&1; r2=$?
[ $r1 -eq 2 ] && [ $r2 -eq 2 ] && ok "optional: unknown tool → rc 2 · no tool → rc 2" || no "optional input errors $r1 $r2"
finish
