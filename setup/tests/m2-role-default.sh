#!/usr/bin/env bash
# m2-role-default.sh — role-default.sh copies a role's starter files (CLAUDE.md + persona.md) into a bot folder; with no starter
# folder it says «건너뜀(틀 없음)» and writes nothing (it never makes a starter up). Never overwrites · twice = nothing new.
#   bash setup/tests/m2-role-default.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m2-role)"
trap 'rm -rf "$T"' EXIT
RD="$SETUP_DIR/lib/role-default.sh"
mkdir -p "$T/tpl/lead" "$T/tpl/watch/sub"
printf '# lead starter\n' > "$T/tpl/lead/CLAUDE.md"; printf 'lead persona\n' > "$T/tpl/lead/persona.md"
printf '# watch starter\n' > "$T/tpl/watch/CLAUDE.md"; printf 'sub file\n' > "$T/tpl/watch/sub/extra.md"
# positive: copy
out="$("$BASHX" "$RD" lead "$T/bots/lead" --templates "$T/tpl" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(cat "$T/bots/lead/CLAUDE.md")" = "# lead starter" ] && [ "$(cat "$T/bots/lead/persona.md")" = "lead persona" ] && [ "$(mode_of "$T/bots/lead/persona.md")" = 644 ] \
  && printf '%s' "$out" | grep -q '결과: 복사 2 · 그대로 0 · 안 덮음 0' && ok "role lead: rc 0 · CLAUDE.md + persona.md copied (0644) · «복사 2»" || { no "role copy rc=$rc"; printf '%s\n' "$out"; }
# twice = nothing new
before="$(listing "$T/bots")"
out="$("$BASHX" "$RD" lead "$T/bots/lead" --templates "$T/tpl" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(listing "$T/bots")" = "$before" ] && printf '%s' "$out" | grep -q '결과: 복사 0 · 그대로 2' && ok "role lead again: «복사 0 · 그대로 2» · files unchanged" || { no "role again rc=$rc"; printf '%s\n' "$out"; }
# subfolders keep their place
"$BASHX" "$RD" watch "$T/bots/watch" --templates "$T/tpl" > /dev/null 2>&1
[ "$(cat "$T/bots/watch/sub/extra.md")" = "sub file" ] && ok "role watch: a subfolder file keeps its relative place" || no "role subfolder"
# never overwrites
mkdir -p "$T/bots/own"; printf 'MY RULES\n' > "$T/bots/own/CLAUDE.md"
out="$("$BASHX" "$RD" lead "$T/bots/own" --templates "$T/tpl" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(cat "$T/bots/own/CLAUDE.md")" = "MY RULES" ] && [ -f "$T/bots/own/persona.md" ] && printf '%s' "$out" | grep -q '안 덮음 .*CLAUDE.md' && printf '%s' "$out" | grep -q '복사 1 · 그대로 0 · 안 덮음 1' \
  && ok "role into a folder with its own CLAUDE.md: kept as is · persona.md added · reported «안 덮음»" || { no "role no-overwrite rc=$rc"; printf '%s\n' "$out"; }
# no starter for the role → 건너뜀(틀 없음) · nothing written (the bot folder is not even made)
out="$("$BASHX" "$RD" research "$T/bots/research" --templates "$T/tpl" 2>&1)"; rc=$?
[ $rc -eq 0 ] && printf '%s' "$out" | grep -q '건너뜀(틀 없음) research' && [ ! -e "$T/bots/research" ] && ok "role research (no starter folder): rc 0 · «건너뜀(틀 없음)» · bot folder not made" || { no "role skip rc=$rc"; printf '%s\n' "$out"; }
mkdir -p "$T/tpl/research"
out="$("$BASHX" "$RD" research "$T/bots/research" --templates "$T/tpl" 2>&1)"; rc=$?
[ $rc -eq 0 ] && printf '%s' "$out" | grep -q '건너뜀(틀 없음)' && [ ! -e "$T/bots/research" ] && ok "role research (empty starter folder): skipped too" || no "role empty skip rc=$rc"
# dry-run
before="$(listing "$T")"
out="$("$BASHX" "$RD" lead "$T/bots/new" --templates "$T/tpl" --dry-run 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(listing "$T")" = "$before" ] && printf '%s' "$out" | grep -q '^할 일' && printf '%s' "$out" | grep -q '미리 보기' && ok "role --dry-run: plans shown · writes 0" || { no "role dry-run rc=$rc"; printf '%s\n' "$out"; }
# input errors
"$BASHX" "$RD" 'Bad Role' "$T/x" --templates "$T/tpl" > /dev/null 2>&1; r1=$?
"$BASHX" "$RD" lead relative/dir --templates "$T/tpl" > /dev/null 2>&1; r2=$?
"$BASHX" "$RD" lead > /dev/null 2>&1; r3=$?
"$BASHX" "$RD" ../etc "$T/x" --templates "$T/tpl" > /dev/null 2>&1; r4=$?
"$BASHX" "$RD" lead "$T/x" --bogus > /dev/null 2>&1; r5=$?
[ $r1 -eq 2 ] && [ $r2 -eq 2 ] && [ $r3 -eq 2 ] && [ $r4 -eq 2 ] && [ $r5 -eq 2 ] && [ ! -e "$T/x" ] && ok "role input errors (bad role · relative dir · missing arg · ../ role · unknown option) → rc 2 each · nothing made" || no "role input errors $r1 $r2 $r3 $r4 $r5"
# the repo's own starter folder (lane C fills it): either «건너뜀(틀 없음)» or a real copy — both are consistent
REAL="$SETUP_DIR/templates/roles"
for r in lead watch research; do
  out="$("$BASHX" "$RD" "$r" "$T/real-$r" 2>&1)"; rc=$?
  if [ -d "$REAL/$r" ] && [ -n "$(ls -A "$REAL/$r" 2>/dev/null)" ]; then
    n="$(find "$REAL/$r" -type f ! -name .DS_Store | wc -l | tr -d ' ')"
    [ $rc -eq 0 ] && [ "$(find "$T/real-$r" -type f | wc -l | tr -d ' ')" = "$n" ] && ok "repo starter «${r}»: $n file(s) copied into a new bot folder" || no "repo starter $r rc=$rc"
  else
    [ $rc -eq 0 ] && printf '%s' "$out" | grep -q '건너뜀(틀 없음)' && [ ! -e "$T/real-$r" ] && ok "repo starter «${r}»: not there yet → 건너뜀(틀 없음) (lane C fills it)" || no "repo starter $r skip rc=$rc"
  fi
done
# a bot folder that is a cloned repository can commit a link named like the temp file: the starter never lands outside it
mkdir -p "$T/bots/clone"; printf 'keep\n' > "$T/outside.txt"; ln -s "$T/outside.txt" "$T/bots/clone/persona.md.slackmod-tmp"
out="$("$BASHX" "$RD" lead "$T/bots/clone" --templates "$T/tpl" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(cat "$T/outside.txt")" = "keep" ] && [ -f "$T/bots/clone/persona.md" ] && [ ! -L "$T/bots/clone/persona.md" ] && [ "$(cat "$T/bots/clone/persona.md")" = "lead persona" ] && [ "$(mode_of "$T/bots/clone/persona.md")" = 644 ] \
  && ok "role into a folder with a planted persona.md.slackmod-tmp link: the outside file is untouched · persona.md is a plain 0644 copy" || { no "role planted temp link rc=$rc outside=$(cat "$T/outside.txt")"; printf '%s\n' "$out"; }
finish
