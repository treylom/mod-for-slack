#!/usr/bin/env bash
# m2-apply-extras.sh — the two wizard columns that really change a bot folder when «install.sh --plan» runs:
#   ③ wiki    → <work_dir>/.claude/settings.json  permissions.additionalDirectories gets the wiki folder
#   ⑦ browser → <work_dir>/.mcp.json              «playwright» → the pinned server entry under mcpServers
#               + <work_dir>/.claude/settings.json enabledMcpjsonServers [playwright] when that entry is the kit's own (K19b)
# Contract: merged into what is there (other keys kept · mode kept) · twice = 바뀜 0 / no duplicate · a changed existing file is
# backed up first · a broken existing file (not JSON · wrong shape) = rc 2 and NOTHING written anywhere · dry-run writes 0 ·
# aside / none / wiki null = hands off · an old config without these keys = no new files.
#   bash setup/tests/m2-apply-extras.sh        Throwaway HOMEs only. rc 0 = all PASS.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/plan-lib.sh"
T="$(mk_tmp m2-extras)"
trap 'rm -rf "$T"' EXIT
B="$T/bundle"; make_bundle "$B"
PIN='@playwright/mcp@0.0.83'
jget() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2"; }

# ③ wiki
new_home; WIKI="$H/wiki"; mk_setup "$T/w1.json" "d['wiki']['path'] = '$WIKI'; d['browser'] = 'none'"
plan_run "$T/w1.json"
S1="$H/bots/lead/.claude/settings.json"; S2="$H/bots/watch/.claude/settings.json"
if [ $RC -eq 0 ] && [ "$(jget "$S1" "d['permissions']['additionalDirectories']")" = "['$WIKI']" ] && [ "$(jget "$S2" "d['permissions']['additionalDirectories']")" = "['$WIKI']" ] \
   && [ "$(mode_of "$S1")" = 644 ] && [ ! -e "$H/bots/lead/.mcp.json" ]; then
  ok "③a wiki set: both bots' .claude/settings.json get permissions.additionalDirectories = [wiki] (0644) · no .mcp.json (browser none)"
else no "③a wiki rc=$RC"; printf '%s\n' "$OUT" | tail -5; fi
before="$(listing "$H" | grep -v 'state/install.fp')"; plan_run "$T/w1.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] \
  && ok "③b wiki again: 바뀜 0 · files unchanged (no duplicate entry)" || { no "③b again rc=$RC $(count0 "$OUT")"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -4; }
# merge into an existing settings file: keys kept, mode kept, one backup with the old text, then stable
new_home; WIKI="$H/wiki"; mkdir -p "$H/bots/lead/.claude" "$H/bots/watch"
printf '{"model":"opus","permissions":{"allow":["Bash(ls)"],"additionalDirectories":["/other"]},"env":{"FOO":"1"}}\n' > "$H/bots/lead/.claude/settings.json"
chmod 600 "$H/bots/lead/.claude/settings.json"; OLD="$(cat "$H/bots/lead/.claude/settings.json")"
mk_setup "$T/w2.json" "d['wiki']['path'] = '$WIKI'; d['browser'] = 'none'"
plan_run "$T/w2.json"
S1="$H/bots/lead/.claude/settings.json"
bk="$(find "$H/.slackmod/backup" -path '*bots/lead/.claude/settings.json' 2>/dev/null | head -1)"
if [ $RC -eq 0 ] && [ "$(jget "$S1" "d['permissions']['additionalDirectories']")" = "['/other', '$WIKI']" ] && [ "$(jget "$S1" "d['permissions']['allow']")" = "['Bash(ls)']" ] \
   && [ "$(jget "$S1" "d['model'] + d['env']['FOO']")" = "opus1" ] && [ "$(mode_of "$S1")" = 600 ] && [ -n "$bk" ] && [ "$(cat "$bk")" = "$OLD" ]; then
  ok "③c merge: other keys kept · /other kept + wiki appended · mode stays 600 · old text backed up byte-for-byte"
else no "③c merge rc=$RC backup=${bk:-none}"; cat "$S1"; fi
before="$(listing "$H" | grep -v 'state/install.fp')"; plan_run "$T/w2.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] && ok "③d merged file again: 바뀜 0" || no "③d again rc=$RC $(count0 "$OUT")"
# the wiki already listed → the file is not touched at all (same bytes, no backup)
new_home; WIKI="$H/wiki"; mkdir -p "$H/bots/lead/.claude"
printf '{\n"permissions": {"additionalDirectories": ["%s"]}\n}\n' "$WIKI" > "$H/bots/lead/.claude/settings.json"; OLD="$(cat "$H/bots/lead/.claude/settings.json")"
mk_setup "$T/w3.json" "d['wiki']['path'] = '$WIKI'; d['browser'] = 'none'"; plan_run "$T/w3.json"
nb="$(find "$H/.slackmod/backup" -path '*lead/.claude/settings.json' 2>/dev/null | wc -l | tr -d ' ')"
[ $RC -eq 0 ] && [ "$(cat "$H/bots/lead/.claude/settings.json")" = "$OLD" ] && [ "$nb" = 0 ] && ok "③e wiki already in the list: file untouched (same bytes · no backup · no duplicate)" || no "③e rc=$RC backups=$nb"
# broken existing files → rc 2 · nothing written anywhere · the file untouched · the path named
for case_ in 'not json|{bad' 'array|[1,2]' 'permissions string|{"permissions": "x"}' 'dirs not list|{"permissions": {"additionalDirectories": "x"}}'; do
  label="${case_%%|*}"; body="${case_#*|}"
  new_home; WIKI="$H/wiki"; mkdir -p "$H/bots/lead/.claude"; printf '%s\n' "$body" > "$H/bots/lead/.claude/settings.json"
  mk_setup "$T/w4.json" "d['wiki']['path'] = '$WIKI'; d['browser'] = 'none'"
  before="$(listing "$H")"; plan_run "$T/w4.json"
  [ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'lead/.claude/settings.json' && [ "$(cat "$H/bots/lead/.claude/settings.json")" = "$body" ] \
    && ok "③f broken settings ($label): rc 2 · nothing written anywhere (HOME listing same) · file untouched · path named" || { no "③f broken ($label) rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
done
# wiki null → hands off
new_home; mk_setup "$T/w5.json" "d['browser'] = 'none'"; plan_run "$T/w5.json"
[ $RC -eq 0 ] && [ ! -e "$H/bots/lead/.claude" ] && ok "③g wiki null: no .claude folder made in the bot folder" || no "③g rc=$RC"
# ⑦ browser
new_home; mk_setup "$T/b1.json" "d['browser'] = 'playwright'"; plan_run "$T/b1.json"
M1="$H/bots/lead/.mcp.json"
[ $RC -eq 0 ] && [ "$(jget "$M1" "d['mcpServers']['playwright']['command']")" = npx ] && [ "$(jget "$M1" "d['mcpServers']['playwright']['args']")" = "['-y', '$PIN']" ] \
  && [ "$(mode_of "$M1")" = 644 ] && [ -f "$H/bots/watch/.mcp.json" ] \
  && ok "⑦a playwright: both bots get .mcp.json mcpServers.playwright = npx -y $PIN (0644)" || { no "⑦a playwright rc=$RC"; cat "$M1" 2>/dev/null; }
# K19b (measured 2026-10-25: a project .mcp.json server stops a fresh Claude Code at «New MCP server found», cursor on «Continue
# without») — the kit pre-approves the ONE server it added, in the bot folder's project settings (enabledMcpjsonServers)
SA="$H/bots/lead/.claude/settings.json"; SB="$H/bots/watch/.claude/settings.json"
[ $RC -eq 0 ] && [ "$(jget "$SA" "d")" = "{'enabledMcpjsonServers': ['playwright']}" ] && [ "$(jget "$SB" "d['enabledMcpjsonServers']")" = "['playwright']" ] \
  && ok "⑦a2 playwright: both bots' .claude/settings.json = {enabledMcpjsonServers: [playwright]} only (no first-launch MCP dialog)" || { no "⑦a2 approval rc=$RC"; cat "$SA" 2>/dev/null; }
before="$(listing "$H" | grep -v 'state/install.fp')"; plan_run "$T/b1.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] && ok "⑦b playwright again: 바뀜 0" || no "⑦b again rc=$RC $(count0 "$OUT")"
# merge: another server kept, playwright added; mode kept; backup
new_home; mkdir -p "$H/bots/lead"; printf '{"mcpServers":{"other":{"command":"x","args":["y"]}},"note":1}\n' > "$H/bots/lead/.mcp.json"; chmod 640 "$H/bots/lead/.mcp.json"; OLD="$(cat "$H/bots/lead/.mcp.json")"
mk_setup "$T/b2.json" "d['browser'] = 'playwright'"; plan_run "$T/b2.json"
M1="$H/bots/lead/.mcp.json"; bk="$(find "$H/.slackmod/backup" -path '*bots/lead/.mcp.json' 2>/dev/null | head -1)"
[ $RC -eq 0 ] && [ "$(jget "$M1" "sorted(d['mcpServers'])")" = "['other', 'playwright']" ] && [ "$(jget "$M1" "d['mcpServers']['other']['args']")" = "['y']" ] && [ "$(jget "$M1" "d['note']")" = 1 ] \
  && [ "$(mode_of "$M1")" = 640 ] && [ -n "$bk" ] && [ "$(cat "$bk")" = "$OLD" ] \
  && ok "⑦c merge: 'other' server kept · playwright added · other keys kept · mode stays 640 · old text backed up" || { no "⑦c merge rc=$RC"; cat "$M1"; }
# an existing playwright entry (user's own) is left alone
new_home; mkdir -p "$H/bots/lead"; printf '{"mcpServers":{"playwright":{"command":"my-pw","args":[]}}}\n' > "$H/bots/lead/.mcp.json"; OLD="$(cat "$H/bots/lead/.mcp.json")"
mk_setup "$T/b3.json" "d['browser'] = 'playwright'"; plan_run "$T/b3.json"
nb="$(find "$H/.slackmod/backup" -path '*lead/.mcp.json' 2>/dev/null | wc -l | tr -d ' ')"
[ $RC -eq 0 ] && [ "$(cat "$H/bots/lead/.mcp.json")" = "$OLD" ] && [ "$nb" = 0 ] && ok "⑦d user's own playwright entry: file untouched (same bytes · no backup)" || no "⑦d rc=$RC backups=$nb"
[ $RC -eq 0 ] && [ ! -e "$H/bots/lead/.claude/settings.json" ] && [ "$(jget "$H/bots/watch/.claude/settings.json" "d['enabledMcpjsonServers']")" = "['playwright']" ] \
  && ok "⑦d2 user's own playwright entry: NOT pre-approved (that consent stays the user's) · the other bot (kit entry) is" || no "⑦d2 approval of a user's own server"
# wiki + playwright: both land in the SAME settings file (one merge — two separate merges would overwrite each other)
new_home; WIKI="$H/wiki"; mk_setup "$T/b7.json" "d['wiki']['path'] = '$WIKI'"; plan_run "$T/b7.json"
SA="$H/bots/lead/.claude/settings.json"
[ $RC -eq 0 ] && [ "$(jget "$SA" "d['permissions']['additionalDirectories']")" = "['$WIKI']" ] && [ "$(jget "$SA" "d['enabledMcpjsonServers']")" = "['playwright']" ] \
  && ok "⑦h wiki + playwright: one settings.json holds both (additionalDirectories = [wiki] · enabledMcpjsonServers = [playwright])" || { no "⑦h both rc=$RC"; cat "$SA" 2>/dev/null; }
before="$(listing "$H" | grep -v 'state/install.fp')"; plan_run "$T/b7.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] && ok "⑦h2 again: 바뀜 0" || no "⑦h2 again rc=$RC $(count0 "$OUT")"
# the user turned it off (disabledMcpjsonServers) → stays off · other approvals kept and playwright appended
new_home; mkdir -p "$H/bots/lead/.claude" "$H/bots/watch/.claude"
printf '{"disabledMcpjsonServers":["playwright"]}\n' > "$H/bots/lead/.claude/settings.json"; OLD="$(cat "$H/bots/lead/.claude/settings.json")"
printf '{"enabledMcpjsonServers":["other"],"model":"opus"}\n' > "$H/bots/watch/.claude/settings.json"
mk_setup "$T/b8.json" "d['browser'] = 'playwright'"; plan_run "$T/b8.json"
[ $RC -eq 0 ] && [ "$(cat "$H/bots/lead/.claude/settings.json")" = "$OLD" ] && [ "$(jget "$H/bots/watch/.claude/settings.json" "d['enabledMcpjsonServers']")" = "['other', 'playwright']" ] \
  && [ "$(jget "$H/bots/watch/.claude/settings.json" "d['model']")" = opus ] \
  && ok "⑦i user disabled playwright: left disabled (file same bytes) · other bot: [other] kept + playwright appended · other keys kept" || { no "⑦i rc=$RC"; cat "$H/bots/lead/.claude/settings.json" "$H/bots/watch/.claude/settings.json" 2>/dev/null; }
# an earlier install already put the kit's own entry in .mcp.json (no approval then) → the approval is added now
new_home; mkdir -p "$H/bots/lead"; printf '{"mcpServers":{"playwright":{"command":"npx","args":["-y","%s"]}}}\n' "$PIN" > "$H/bots/lead/.mcp.json"
mk_setup "$T/b9.json" "d['browser'] = 'playwright'"; plan_run "$T/b9.json"
[ $RC -eq 0 ] && [ "$(jget "$H/bots/lead/.claude/settings.json" "d['enabledMcpjsonServers']")" = "['playwright']" ] \
  && ok "⑦j kit's own entry already there (older install): approval added" || { no "⑦j rc=$RC"; cat "$H/bots/lead/.claude/settings.json" 2>/dev/null; }
# a broken enabledMcpjsonServers (not a list) → rc 2 · nothing written
new_home; mkdir -p "$H/bots/lead/.claude"; printf '{"enabledMcpjsonServers":"x"}\n' > "$H/bots/lead/.claude/settings.json"
mk_setup "$T/b10.json" "d['browser'] = 'playwright'"; before="$(listing "$H")"; plan_run "$T/b10.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'enabledMcpjsonServers' \
  && ok "⑦k enabledMcpjsonServers not a list: rc 2 · nothing written · key named" || { no "⑦k rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# aside / none = hands off (and an existing .mcp.json stays as it is)
for br in aside none; do
  new_home; mkdir -p "$H/bots/lead"; printf '{"mcpServers":{}}\n' > "$H/bots/lead/.mcp.json"; OLD="$(cat "$H/bots/lead/.mcp.json")"
  mk_setup "$T/b4.json" "d['browser'] = '$br'"; plan_run "$T/b4.json"
  [ $RC -eq 0 ] && [ "$(cat "$H/bots/lead/.mcp.json")" = "$OLD" ] && [ ! -e "$H/bots/watch/.mcp.json" ] && ok "⑦e browser $br: hands off (existing .mcp.json same · none made in the other bot)" || no "⑦e $br rc=$RC"
done
# broken .mcp.json → rc 2 · nothing written
for case_ in 'not json|{bad' 'array|[]' 'mcpServers string|{"mcpServers": "x"}'; do
  label="${case_%%|*}"; body="${case_#*|}"
  new_home; mkdir -p "$H/bots/lead"; printf '%s\n' "$body" > "$H/bots/lead/.mcp.json"
  mk_setup "$T/b5.json" "d['browser'] = 'playwright'"; before="$(listing "$H")"; plan_run "$T/b5.json"
  [ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'lead/.mcp.json' && [ "$(cat "$H/bots/lead/.mcp.json")" = "$body" ] \
    && ok "⑦f broken .mcp.json ($label): rc 2 · nothing written anywhere · file untouched · path named" || { no "⑦f broken ($label) rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
done
# a broken settings.json in the SECOND bot still stops before the first bot's files are written
new_home; WIKI="$H/wiki"; mkdir -p "$H/bots/watch/.claude"; printf '{bad\n' > "$H/bots/watch/.claude/settings.json"
mk_setup "$T/b6.json" "d['wiki']['path'] = '$WIKI'"; before="$(listing "$H")"; plan_run "$T/b6.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && [ ! -e "$H/.slackmod" ] && ok "⑦g broken file in bot 2: rc 2 · bot 1 not written either · no ~/.slackmod at all (fail before the first write)" || { no "⑦g rc=$RC"; ls -a "$H"; }
# dry-run with existing files: reports the change, writes 0
new_home; WIKI="$H/wiki"; mkdir -p "$H/bots/lead/.claude"; printf '{"permissions":{"allow":["Bash(ls)"]}}\n' > "$H/bots/lead/.claude/settings.json"
mk_setup "$T/d1.json" "d['wiki']['path'] = '$WIKI'"; before="$(listing "$H")"; plan_run "$T/d1.json" --dry-run
[ $RC -eq 0 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'lead/.claude/settings.json' && printf '%s' "$OUT" | grep -q 'lead/.mcp.json' \
  && ok "dry-run with existing project files: rc 0 · HOME listing unchanged · both planned writes shown" || { no "dry-run rc=$RC"; printf '%s\n' "$OUT" | tail -5; }
# blank mode: nothing
new_home; mk_setup "$T/n1.json" "d['mode'] = 'blank'; d['bots'] = []; d['wiki']['path'] = '$H/wiki'"; plan_run "$T/n1.json"
[ $RC -eq 0 ] && [ ! -e "$H/bots" ] && ok "blank mode with wiki+browser set: no bot folder touched (none made)" || no "blank rc=$RC"
# an old config without wiki/browser keys (the hand-filled path) → no extras
new_home
env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm > /dev/null 2>&1; fill_config "$H"
env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm > "$T/old.log" 2>&1; rc=$?
[ $rc -eq 0 ] && [ ! -e "$H/bots/chonggwal/.mcp.json" ] && [ ! -e "$H/bots/chonggwal/.claude" ] && ok "old hand-filled config (no wiki/browser keys): installs as before · no .mcp.json · no .claude in the bot folder" || no "old config rc=$rc"
finish
