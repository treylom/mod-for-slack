#!/usr/bin/env bash
# m4-help.sh — the base layer's help skill («무엇을 쓰면 되나요?»): a setup file from the stage-1 wizard (it always carries
# «recommend») installs <work_dir>/.claude/skills/slackmod-help/SKILL.md in every bot folder · an older setup file (no
# «recommend») and a hand-written config without help_skill install nothing new (golden bytes kept) · undo takes it away ·
# a user's own file at that place is backed up and restored by undo.
#   bash setup/tests/m4-help.sh        rc 0 = all PASS (throwaway HOMEs only)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m4-help)"
trap 'rm -rf "$T"' EXIT
B="$T/bundle"; make_bundle "$B"
. "$SETUP_TESTS_DIR/plan-lib.sh"
inst() { local f="$1"; shift; OUT="$( export SHELL=/bin/zsh HOME="$H"; "$BASHX" "$B/install.sh" --no-npm --plan "$f" "$@" 2>&1 )"; RC=$?; }
sm() { OUT="$( export HOME="$H"; "$BASHX" "$H/.slackmod/bin/slackmod" "$@" 2>&1 )"; RC=$?; }
TPL="$PORT_DIR/templates/skills/slackmod-help/SKILL.md"
[ -f "$B/templates/skills/slackmod-help/SKILL.md" ] && ok "0 make_bundle ships the help skill template" || no "0 template not in the test bundle"

# ① new wizard setup (recommend present) → every bot folder gets the skill, byte-equal to the template
new_home; mk_setup "$T/h1.json" "d['recommend'] = {'take': [], 'declined': []}"
inst "$T/h1.json"
n=0; for b in lead watch; do
  f="$H/bots/$b/.claude/skills/slackmod-help/SKILL.md"
  [ -f "$f" ] && cmp -s "$f" "$TPL" && n=$((n + 1))
done
[ $RC -eq 0 ] && [ "$n" = 2 ] && ok "① recommend present → help skill in 2/2 bot folders (same bytes as the template)" || { no "① rc=$RC n=$n"; printf '%s\n' "$OUT" | tail -3; }
[ "$(cfg "d.get('help_skill')")" = True ] && ok "① config help_skill true" || no "① config help_skill: $(cfg "d.get('help_skill')")"
# undo takes it away
sm undo --yes
[ $RC -eq 0 ] && [ ! -e "$H/bots/lead/.claude/skills/slackmod-help" ] && ok "① undo --yes → help skill gone" || { no "① undo rc=$RC"; printf '%s\n' "$OUT" | tail -3; }

# ② older setup file (no recommend) → no help skill (negative pair)
new_home; mk_setup "$T/h2.json" "d.pop('recommend', None)"
inst "$T/h2.json"
[ $RC -eq 0 ] && [ ! -e "$H/bots/lead/.claude/skills/slackmod-help" ] && [ "$(cfg "'help_skill' in d")" = False ] \
  && ok "② no recommend column → no help skill · no config key" || { no "② rc=$RC"; printf '%s\n' "$OUT" | tail -3; }

# ③ the user's own file at that place: backed up, then restored byte-equal by undo
new_home; mk_setup "$T/h3.json" "d['recommend'] = {'take': [], 'declined': []}"
mkdir -p "$H/bots/lead/.claude/skills/slackmod-help"; printf 'my own help\n' > "$H/bots/lead/.claude/skills/slackmod-help/SKILL.md"
inst "$T/h3.json"
cmp -s "$H/bots/lead/.claude/skills/slackmod-help/SKILL.md" "$TPL" && ok "③ install replaces it with the kit's skill" || no "③ not replaced"
sm undo --yes
[ "$(cat "$H/bots/lead/.claude/skills/slackmod-help/SKILL.md" 2>/dev/null)" = "my own help" ] && ok "③ undo → the user's own file back" || no "③ own file not restored: rc=$RC"

# ④ second install of the same file → 바뀜 0
new_home; mk_setup "$T/h4.json" "d['recommend'] = {'take': [], 'declined': []}"
inst "$T/h4.json"; inst "$T/h4.json"
printf '%s\n' "$OUT" | grep -q '^결과: 바뀜 0 ' && ok "④ second install → 바뀜 0" || { no "④ second run"; printf '%s\n' "$OUT" | grep '^결과' ; }

# ⑤ a config with help_skill not bool → validate names it
new_home; mkdir -p "$H/.slackmod"
python3 -I - "$PORT_DIR/lib/slackmod_config.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location('c', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cfg = {'schema': 1, 'slack': {'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01'}, 'bots': [{'name': 'lead', 'work_dir': '/w/lead'}], 'help_skill': 'yes'}
p = m.problems(cfg)
print('PASS ⑤ help_skill "yes" refused' if any(x.startswith('help_skill:') for x in p) else 'FAIL ⑤ not refused: %s' % p)
PY

# ⑥ every «--section NAME» the help skill names is one the wizard knows (the setup command's NAME list · the wizard's new columns)
KNOWN="$( { command grep -m1 'NAME 은' "$SETUP_DIR/commands/setup.md"; command grep -m1 '^새 칸 이름:' "$SETUP_DIR/skills/mods-setup/SKILL.md"; } \
  | command grep -o '`[a-z][a-z0-9-]*`' | tr -d '`' | sort -u)"
USED="$(command grep -o -e '--section [a-z][a-z0-9-]*' "$TPL" | sed 's/^--section //' | sort -u)"
MISS=""; for s in $USED; do printf '%s\n' "$KNOWN" | grep -qx -- "$s" || MISS="$MISS $s"; done
[ -n "$USED" ] && [ -z "$MISS" ] && printf '%s\n' "$KNOWN" | grep -qx doctor && ! printf '%s\n' "$KNOWN" | grep -qx weather \
  && ok "⑥ help skill «--section» names ($(printf '%s' "$USED" | tr '\n' ' ')) are all wizard sections ($(printf '%s\n' "$KNOWN" | wc -l | tr -d ' ') known · bait «weather» not known · 미끼 2/2)" \
  || no "⑥ help skill names unknown sections:$MISS (known: $(printf '%s' "$KNOWN" | tr '\n' ' '))"
echo "m4-help: PASS $PASSN · FAIL $FAIL"
[ "$FAIL" = 0 ]
