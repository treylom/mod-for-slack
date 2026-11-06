#!/usr/bin/env bash
# m4-undo.sh — «slackmod undo»: the record of one install run (port/lib/record.py + install.sh) and undoing exactly that run.
#   ① install on a HOME that already has a bot-folder settings.json and a ~/.zshrc → a record (state/installs/last)
#   ② undo without --yes = the plan only: HOME listing unchanged (every file · state included)
#   ③ undo --yes → HOME listing == before the install, except the rule below · the user's settings.json / .zshrc = their old
#      bytes and mode · the record renamed *.undone · «last» gone · the bots' slack/.env kept
#   ④ undo again → «되돌릴 설치가 없습니다» rc 0
#   ⑤ install twice → the second changes nothing: no new record, «last» the same, install.fp the same (state/ is not fingerprinted)
#   ⑥ a file edited by hand after the install (the bot folder's .claude/settings.json) → undo --yes: rc 3, nothing changed
#      (listing the same), the file named
#   ⑦ the starter notes folder made by an install → gone after undo --yes
#   ⑧ the wizard's own writes: record.py begin --watch <bot folder> before the install, SLACKMOD_RECORD_DIR → undo puts the
#      folder's files back (edited one = old bytes · new one gone)
#   ⑨ preview (--dry-run) leaves no record · a kit without lib/record.py installs as before (no record · «slackmod undo» says so)
#   ⑩ ~/.zshrc = a link (dotfiles inside / outside HOME) → the real file is backed up and put back, the link stays · hand edit → rc 3
#   ⑪ a watch folder that holds ~/.slackmod (HOME) → nothing under ~/.slackmod's backup/state and no slack/.env recorded from it
#   ⑫ record.json edited by hand (a path outside HOME · a backup outside the record) → rc 3, nothing changed
#   ⑬ a parent folder swapped for a link (bot folder moved out) → rc 3 · a file / tree swapped for a link → rc 3 · HOME through
#      /tmp → /private/tmp → no false stop
#   ⑭ backup gone → rc 3, nothing changed · ⑮ a replaced bridge folder comes back with node_modules kept
#   ⑯ a watch folder missing at begin → the folders made for it go (deepest first · only when empty · a non-empty one is named)
#   ⑰ wizard order: record first (--watch-file setup.json), then setup.json → undo removes / restores it
# Listing rule after undo (what undo leaves on purpose): ~/.slackmod itself · ~/.slackmod/state/** (records · install.fp ·
# bundle-path) · ~/.slackmod/backup/** · ~/.slackmod/bots · ~/.slackmod/bots/<bot> · ~/.slackmod/bots/<bot>/slack ·
# ~/.slackmod/bots/<bot>/slack/.env (the bot's Slack tokens are never recorded nor undone). Everything else must match.
#   bash setup/tests/m4-undo.sh          rc 0 = all PASS (throwaway HOMEs only)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m4-undo)"
trap 'rm -rf "$T"' EXIT
B="$T/bundle"; make_bundle "$B"
cp "$PORT_DIR/lib/record.py" "$B/lib/"; cp -R "$PORT_DIR/templates/starter-wiki" "$B/templates/"
. "$SETUP_TESTS_DIR/plan-lib.sh"
inst() { local f="$1"; shift; OUT="$( export SHELL=/bin/zsh HOME="$H"; "$BASHX" "$B/install.sh" --no-npm --plan "$f" "$@" 2>&1 )"; RC=$?; }
sm() { OUT="$( export HOME="$H"; "$BASHX" "$H/.slackmod/bin/slackmod" "$@" 2>&1 )"; RC=$?; }
# the listing without what undo leaves on purpose (see the rule above)
kept() { listing "$H" | grep -v -E '^\./\.slackmod(/state(/[^ ]*)?|/backup(/[^ ]*)?|/bots|/bots/[^/ ]+|/bots/[^/ ]+/slack|/bots/[^/ ]+/slack/\.env)?( [0-9]+ [0-9a-f]+)?$'; }
last_of() { cat "$H/.slackmod/state/installs/last" 2>/dev/null; }
nrec() { find "$H/.slackmod/state/installs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '; }

# ① a HOME with the user's own files
new_home; mk_setup "$T/u1.json"
mkdir -p "$H/bots/lead/.claude"
printf '{"model": "opus", "permissions": {"allow": ["Bash(ls)"]}}\n' > "$H/bots/lead/.claude/settings.json"; chmod 640 "$H/bots/lead/.claude/settings.json"
cp -p "$H/bots/lead/.claude/settings.json" "$T/u1-settings.orig"
printf 'export MY_OWN=1\n' > "$H/.zshrc"; cp -p "$H/.zshrc" "$T/u1-zshrc.orig"
A="$(kept)"; A_ALL="$(listing "$H")"
inst "$T/u1.json"
L1="$(last_of)"
[ $RC -eq 0 ] && [ -n "$L1" ] && [ -f "$H/.slackmod/state/installs/$L1/record.json" ] && [ -f "$H/.slackmod/lib/record.py" ] \
  && ! cmp -s "$H/bots/lead/.claude/settings.json" "$T/u1-settings.orig" && printf '%s' "$OUT" | grep -q '^되돌리기: slackmod undo' \
  && ok "① install → record $L1 (record.json · last) · lib/record.py installed · the user's settings.json merged · «되돌리기: slackmod undo» line" \
  || { no "① rc=$RC last=$L1"; printf '%s\n' "$OUT" | tail -5; }
grep -q '"path": ".*slack/.env"' "$H/.slackmod/state/installs/$L1/record.json" && no "①b a bot slack/.env is in the record" \
  || ok "①b the record holds no bot slack/.env line (tokens are never recorded) · bait: the record does name harness.json ($(grep -c 'harness.json' "$H/.slackmod/state/installs/$L1/record.json"))"
# ② undo without --yes = plan only
P2="$(listing "$H")"
sm undo
[ $RC -eq 0 ] && [ "$(listing "$H")" = "$P2" ] && printf '%s' "$OUT" | grep -q 'slackmod undo --yes' && printf '%s' "$OUT" | grep -q '되돌림 .*settings.json' \
  && ok "② undo (no --yes) → rc 0 · the plan (settings.json back · …) · HOME listing unchanged, state included ($(printf '%s\n' "$P2" | wc -l | tr -d ' ') entries)" \
  || { no "② rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
# ③ undo --yes
sm undo --yes
B3="$(kept)"
[ $RC -eq 0 ] && [ "$B3" = "$A" ] && printf '%s' "$OUT" | grep -q '^결과: 되돌림 [0-9]* · 그대로 [0-9]*' \
  && ok "③a undo --yes → HOME listing == before the install (rule: ~/.slackmod/state · backup · bots/<bot>/slack/.env kept) · $(printf '%s' "$OUT" | grep '^결과:')" \
  || { no "③a rc=$RC"; diff <(printf '%s\n' "$A") <(printf '%s\n' "$B3") | head -10; printf '%s\n' "$OUT" | tail -3; }
cmp -s "$H/bots/lead/.claude/settings.json" "$T/u1-settings.orig" && [ "$(mode_of "$H/bots/lead/.claude/settings.json")" = 640 ] \
  && cmp -s "$H/.zshrc" "$T/u1-zshrc.orig" && [ "$(mode_of "$H/.zshrc")" = "$(mode_of "$T/u1-zshrc.orig")" ] \
  && ok "③b the user's own files are back: bot settings.json (same bytes · mode 640) · ~/.zshrc (same bytes · mode)" || no "③b settings/zshrc not restored"
[ -z "$(last_of)" ] && [ -d "$H/.slackmod/state/installs/$L1.undone" ] && [ -f "$H/.slackmod/bots/lead/slack/.env" ] && [ ! -e "$H/.slackmod/bin/slackmod" ] \
  && ok "③c «last» removed · record renamed $L1.undone · bot slack/.env kept (tokens) · ~/.slackmod/bin/slackmod gone" || no "③c last=$(last_of)"
# ④ undo again — the record tool is gone with the install, so call the kit's copy the way slackmod does
OUT="$(python3 -I "$B/lib/record.py" undo --root "$H/.slackmod" --yes 2>&1)"; RC=$?
[ $RC -eq 0 ] && [ "$OUT" = "되돌릴 설치가 없습니다" ] && ok "④ undo again → «되돌릴 설치가 없습니다» rc 0" || no "④ rc=$RC $OUT"

# ⑤ two installs: the second changes nothing → no new record · last the same · install.fp the same
new_home; mk_setup "$T/u5.json"
inst "$T/u5.json"; L5="$(last_of)"; N5="$(nrec)"; FP5="$(cat "$H/.slackmod/state/install.fp")"
before="$(listing "$H" | grep -v 'state/install.fp')"
inst "$T/u5.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(last_of)" = "$L5" ] && [ "$(nrec)" = "$N5" ] && [ "$N5" = 1 ] \
  && [ "$(cat "$H/.slackmod/state/install.fp")" = "$FP5" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] \
  && ! printf '%s' "$OUT" | grep -q '^되돌리기:' \
  && ok "⑤ install twice → second 바뀜 0 · no new record ($N5 folder) · last still $L5 · install.fp the same (records live in state/, outside it) · listing the same" \
  || { no "⑤ rc=$RC $(count0 "$OUT") last $(last_of)/$L5 records $(nrec)/$N5"; printf '%s\n' "$OUT" | tail -3; }
# ⑥ a file edited by hand after the install → undo refuses, changes nothing
S6="$H/bots/lead/.claude/settings.json"
printf '\n' >> "$S6"
P6="$(listing "$H")"
sm undo --yes
[ $RC -eq 3 ] && [ "$(listing "$H")" = "$P6" ] && printf '%s' "$OUT" | grep -q '설치 뒤 손으로 고친 파일이 있어 아무것도 바꾸지 않았습니다' \
  && printf '%s' "$OUT" | grep -qF "$S6" && ! printf '%s' "$OUT" | grep -qF "$H/bots/watch/.claude/settings.json" && [ "$(last_of)" = "$L5" ] \
  && ok "⑥ hand-edited lead settings.json → undo --yes rc 3 · listing unchanged · names that file (bait: watch's untouched settings.json not named) · record kept" \
  || { no "⑥ rc=$RC"; printf '%s\n' "$OUT" | tail -4; }

# ⑦ starter notes folder → gone after undo
new_home; mk_setup "$T/u7.json" "d['memory_setup'] = {'starter': True, 'starter_path': None, 'external_probe': 'not-run'}"
A7="$(kept)"
inst "$T/u7.json"
W7="$H/SlackModWiki"
[ $RC -eq 0 ] && [ -f "$W7/받은 것/README.md" ] && [ -f "$H/bots/lead/.claude/rules/slackmod-memory.md" ] && ok "⑦a starter install → SlackModWiki (with «받은 것/») + per-bot memory rules" || { no "⑦a rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
sm undo --yes
[ $RC -eq 0 ] && [ ! -e "$W7" ] && [ "$(kept)" = "$A7" ] && [ ! -e "$H/bots" ] \
  && ok "⑦b undo --yes → SlackModWiki gone · the bot folders it made gone · listing == before" || { no "⑦b rc=$RC wiki $( [ -e "$W7" ] && echo left || echo gone)"; diff <(printf '%s\n' "$A7") <(kept) | head -8; }

# ⑧ the wizard's own writes before the install (record.py begin --watch · SLACKMOD_RECORD_DIR)
new_home; mk_setup "$T/u8.json"
mkdir -p "$H/bots/lead"; printf 'old persona\n' > "$H/bots/lead/CLAUDE.md"; cp -p "$H/bots/lead/CLAUDE.md" "$T/u8-claude.orig"
A8="$(kept)"
R8="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H/bots/lead" )"
printf 'new persona from the wizard\n' > "$H/bots/lead/CLAUDE.md"; printf 'role notes\n' > "$H/bots/lead/ROLE.md"
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R8"; "$BASHX" "$B/install.sh" --no-npm --plan "$T/u8.json" 2>&1 )"; RC=$?
[ $RC -eq 0 ] && [ "$(last_of)" = "$(basename "$R8")" ] && grep -q 'ROLE.md' "$R8/record.json" \
  && ok "⑧a begin --watch → install with SLACKMOD_RECORD_DIR uses that record ($(basename "$R8")) · the wizard's new ROLE.md is in it" || { no "⑧a rc=$RC last=$(last_of) rec=$R8"; printf '%s\n' "$OUT" | tail -3; }
sm undo --yes
cmp -s "$H/bots/lead/CLAUDE.md" "$T/u8-claude.orig" && [ ! -e "$H/bots/lead/ROLE.md" ] && [ "$(kept)" = "$A8" ] \
  && ok "⑧b undo --yes → the watched folder is back: CLAUDE.md = old bytes · ROLE.md gone · listing == before the wizard wrote" \
  || { no "⑧b rc=$RC"; diff <(printf '%s\n' "$A8") <(kept) | head -8; }

# ⑨ preview leaves no record · an older kit (no lib/record.py) installs without one
new_home; mk_setup "$T/u9.json"
before="$(listing "$H")"; inst "$T/u9.json" --dry-run
[ $RC -eq 0 ] && [ "$(listing "$H")" = "$before" ] && ok "⑨a --dry-run → HOME listing unchanged (no record folder)" || no "⑨a rc=$RC"
B9="$T/bundle-old"; make_bundle "$B9"; rm -f "$B9/lib/record.py"   # an older kit: make_bundle now ships record.py, take it out
new_home; mk_setup "$T/u9b.json"
OUT="$( export SHELL=/bin/zsh HOME="$H"; "$BASHX" "$B9/install.sh" --no-npm --plan "$T/u9b.json" 2>&1 )"; I9=$?
sm undo; U9=$RC
[ $I9 -eq 0 ] && [ ! -e "$H/.slackmod/state/installs" ] && [ ! -e "$H/.slackmod/lib/record.py" ] && [ $U9 -ne 0 ] && printf '%s' "$OUT" | grep -q '되돌리기 도구가 없습니다' \
  && ok "⑨b a kit without lib/record.py → installs with no record · «slackmod undo» says the tool is missing (rc $U9)" || { no "⑨b undo rc=$U9"; printf '%s\n' "$OUT" | tail -2; }

# ⑩ ~/.zshrc is a link into a dotfiles folder (inside HOME · outside HOME): the real file is backed up, written and put back ·
#    the link stays a link · a hand edit of the real file after the install → rc 3, nothing changed
for where in in out; do
  new_home; mk_setup "$T/u10$where.json"
  if [ "$where" = in ]; then D10="$H/dotfiles"; else D10="$T/dot-out-$N"; fi
  mkdir -p "$D10"; printf 'export MINE=1\n' > "$D10/zshrc"; chmod 640 "$D10/zshrc"; cp -p "$D10/zshrc" "$T/u10$where.orig"
  ln -s "$D10/zshrc" "$H/.zshrc"
  A10="$(kept)"
  inst "$T/u10$where.json"; I10=$RC; G10="$(command grep -c -i 'slackmod' "$D10/zshrc")"
  sm undo --yes
  [ $I10 -eq 0 ] && [ "$G10" -gt 0 ] && [ $RC -eq 0 ] && [ -L "$H/.zshrc" ] && [ "$(readlink "$H/.zshrc")" = "$D10/zshrc" ] \
    && cmp -s "$D10/zshrc" "$T/u10$where.orig" && [ "$(mode_of "$D10/zshrc")" = 640 ] && [ "$(kept)" = "$A10" ] \
    && ok "⑩a ($where HOME) ~/.zshrc = link → install writes the real file (SlackMod lines $G10) · undo --yes rc 0 · still a link · real file = old bytes · mode 640 · listing == before" \
    || { no "⑩a ($where HOME) install rc=$I10 lines=$G10 undo rc=$RC link=$( [ -L "$H/.zshrc" ] && echo yes || echo no) same=$(cmp -s "$D10/zshrc" "$T/u10$where.orig" && echo yes || echo no)"; printf '%s\n' "$OUT" | tail -3; }
done
new_home; mk_setup "$T/u10c.json"
mkdir -p "$H/dotfiles"; printf 'export MINE=1\n' > "$H/dotfiles/zshrc"; ln -s "$H/dotfiles/zshrc" "$H/.zshrc"
inst "$T/u10c.json"
printf 'export LATER=1\n' >> "$H/dotfiles/zshrc"
P10="$(listing "$H")"; S10="$(sha_of "$H/dotfiles/zshrc")"
sm undo --yes
[ $RC -eq 3 ] && [ "$(listing "$H")" = "$P10" ] && [ "$(sha_of "$H/dotfiles/zshrc")" = "$S10" ] && printf '%s' "$OUT" | grep -q 'dotfiles/zshrc' \
  && ok "⑩b the real rc file edited by hand after the install → undo --yes rc 3 · names dotfiles/zshrc · listing and the file unchanged" \
  || { no "⑩b rc=$RC"; printf '%s\n' "$OUT" | tail -3; }

# ⑪ a watch folder that holds ~/.slackmod (HOME itself, called directly): nothing under ~/.slackmod's backup/state and no
#    slack/.env is recorded from the watch walk · a line added to a bot .env after the install does not block undo · .env kept
new_home; mk_setup "$T/u11.json"
printf 'export MINE=1\n' > "$H/.zshrc"; cp -p "$H/.zshrc" "$T/u11-zshrc.orig"
R11="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H" )"
mkdir -p "$H/elsewhere/slack"; printf 'MY_OTHER=1\n' > "$H/elsewhere/slack/.env"   # a slack/.env outside ~/.slackmod, made after begin
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R11"; "$BASHX" "$B/install.sh" --no-npm --plan "$T/u11.json" 2>&1 )"; I11=$?
printf 'MY_LATER_LINE=1\n' >> "$H/.slackmod/bots/lead/slack/.env"
N11="$(command grep -c -E '"path": "[^"]*(/\.slackmod/(backup|state)/|slack/\.env)"' "$R11/record.json")"
P11="$(command grep -c -E '"path": "[^"]*/\.slackmod/bin/slackmod"' "$R11/record.json")"
sm undo --yes
[ $I11 -eq 0 ] && [ "$N11" = 0 ] && [ "$P11" -gt 0 ] && [ $RC -eq 0 ] && command grep -q 'MY_LATER_LINE=1' "$H/.slackmod/bots/lead/slack/.env" \
  && cmp -s "$H/.zshrc" "$T/u11-zshrc.orig" && [ -f "$H/elsewhere/slack/.env" ] \
  && ok "⑪ begin --watch HOME → record: backup/state/slack .env lines 0 · bait ~/.slackmod/bin/slackmod $P11 (미끼 2/2) · undo --yes rc 0 · bot .env kept with the later line · ~/elsewhere/slack/.env kept · ~/.zshrc back" \
  || { no "⑪ install rc=$I11 bad lines=$N11 bait=$P11 undo rc=$RC"; printf '%s\n' "$OUT" | tail -3; }

# ⑫ record.json edited by hand: (a) a path outside HOME · (b) a backup outside the record → rc 3 · names it · nothing changed
forge() { # forge <record.json> <kind> <path> <backup>  → one more line, with the after-install fingerprint it has now
  python3 -I - "$1" "$B/lib" "$2" "$3" "$4" <<'PY'
import json, os, sys
sys.path.insert(0, sys.argv[2]); sys.dont_write_bytecode = True
import record
p, kind, path, backup = sys.argv[1], sys.argv[3], sys.argv[4], sys.argv[5]
r = json.load(open(p))
r['lines'].append({'kind': kind, 'path': path, 'backup': backup, 'mode': '644' if backup else '', 'post': record.now_fp(kind, path),
                   'parent_real': os.path.realpath(os.path.dirname(path))})
json.dump(r, open(p, 'w'), indent=2)
PY
}
new_home; mk_setup "$T/u12a.json"; inst "$T/u12a.json"
O12="$T/outside-12a"; mkdir -p "$O12"; printf 'victim\n' > "$O12/victim.txt"
forge "$H/.slackmod/state/installs/$(last_of)/record.json" new "$O12/victim.txt" ""
P12="$(listing "$H")"; sm undo --yes
[ $RC -eq 3 ] && [ -f "$O12/victim.txt" ] && [ "$(listing "$H")" = "$P12" ] && printf '%s' "$OUT" | grep -qF "$O12/victim.txt" \
  && ok "⑫a a record line outside HOME → undo --yes rc 3 · names it · the outside file kept · HOME listing unchanged" \
  || { no "⑫a rc=$RC victim $( [ -f "$O12/victim.txt" ] && echo kept || echo GONE)"; printf '%s\n' "$OUT" | tail -3; }
new_home; mk_setup "$T/u12b.json"; inst "$T/u12b.json"
O12="$T/outside-12b"; mkdir -p "$O12"; printf 'src\n' > "$O12/src.txt"; printf 'mine\n' > "$H/mine.txt"
forge "$H/.slackmod/state/installs/$(last_of)/record.json" changed "$H/mine.txt" "$O12/src.txt"
P12="$(listing "$H")"; sm undo --yes
[ $RC -eq 3 ] && [ "$(cat "$H/mine.txt")" = mine ] && [ "$(listing "$H")" = "$P12" ] && printf '%s' "$OUT" | grep -qF "$O12/src.txt" \
  && ok "⑫b a record line whose backup is outside the record → undo --yes rc 3 · names it · ~/mine.txt unchanged · listing unchanged" \
  || { no "⑫b rc=$RC mine=$(cat "$H/mine.txt")"; printf '%s\n' "$OUT" | tail -3; }

# ⑬ a recorded folder's parent swapped for a link after the install (bot folder moved out, link left) → rc 3, the moved files
#    kept · a recorded file / tree replaced by a link → rc 3 (as before) · HOME through a link (/tmp → /private/tmp) → no false stop
new_home; mk_setup "$T/u13.json"; inst "$T/u13.json"
O13="$T/outside-13"; mkdir -p "$O13"; mv "$H/bots/lead" "$O13/lead"; ln -s "$O13/lead" "$H/bots/lead"
F13="$(cd "$O13/lead" && find . -type f | LC_ALL=C sort)"
sm undo --yes
[ $RC -eq 3 ] && [ "$(cd "$O13/lead" && find . -type f | LC_ALL=C sort)" = "$F13" ] && [ -n "$F13" ] && printf '%s' "$OUT" | grep -qF "$H/bots/lead/" \
  && ok "⑬a bot folder moved out + link left → undo --yes rc 3 · names a path under it · the moved folder's $(printf '%s\n' "$F13" | wc -l | tr -d ' ') files kept" \
  || { no "⑬a rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
new_home; mk_setup "$T/u13b.json"; inst "$T/u13b.json"
O13="$T/outside-13b"; mkdir -p "$O13"; F="$H/bots/lead/.claude/settings.json"; cp -p "$F" "$O13/settings.json"; rm "$F"; ln -s "$O13/settings.json" "$F"
sm undo --yes
[ $RC -eq 3 ] && [ -f "$O13/settings.json" ] && printf '%s' "$OUT" | grep -qF "$F" && ok "⑬b a recorded file replaced by a link → rc 3 · named · the outside copy kept" || { no "⑬b rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
new_home; mk_setup "$T/u13c.json"; inst "$T/u13c.json"
O13="$T/outside-13c"; mkdir -p "$O13"; mv "$H/.slackmod/app/channel-server" "$O13/cs"; ln -s "$O13/cs" "$H/.slackmod/app/channel-server"
sm undo --yes
[ $RC -eq 3 ] && [ -f "$O13/cs/dist/server.js" ] && ok "⑬c the copied tree replaced by a link → rc 3 · the outside copy kept" || { no "⑬c rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
for base in /tmp /private/tmp; do
  [ -d "$base" ] || continue
  H="$(mktemp -d "$base/m4-undo-home.XXXXXX")"
  mk_setup "$T/u13d.json"; printf 'export MINE=1\n' > "$H/.zshrc"
  A13="$(kept)"; inst "$T/u13d.json"; I13=$RC
  sm undo --yes
  [ $I13 -eq 0 ] && [ $RC -eq 0 ] && [ "$(kept)" = "$A13" ] \
    && ok "⑬d HOME under $base (real path $(cd "$H" && pwd -P | cut -d/ -f1-3)/…) → install · undo --yes rc 0 · listing == before (no false link stop)" \
    || { no "⑬d HOME under $base install rc=$I13 undo rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
  rm -rf "$H"
done

# ⑭ the backup gone before undo → rc 3 · nothing changed
new_home; mk_setup "$T/u14.json"; mkdir -p "$H/bots/lead/.claude"; printf '{"model":"opus"}\n' > "$H/bots/lead/.claude/settings.json"
inst "$T/u14.json"
rm -rf "$H/.slackmod/backup"
P14="$(listing "$H")"; sm undo --yes
[ $RC -eq 3 ] && [ "$(listing "$H")" = "$P14" ] && printf '%s' "$OUT" | grep -q '설치 전 백업이 없어져 아무것도 바꾸지 않았습니다' \
  && ok "⑭ backup folder removed → undo --yes rc 3 · «설치 전 백업이 없어져…» · listing unchanged" || { no "⑭ rc=$RC"; printf '%s\n' "$OUT" | tail -3; }

# ⑮ a second install that replaces the bridge folder → undo puts the old folder back and keeps node_modules (no leftover)
new_home; mk_setup "$T/u15.json"; inst "$T/u15.json"
CS="$H/.slackmod/app/channel-server"
mkdir -p "$CS/node_modules/dep"; printf 'dep\n' > "$CS/node_modules/dep/i.js"; SV1="$(sha_of "$CS/dist/server.js")"
B15="$T/bundle15"; make_bundle "$B15"; printf '// stub bridge v2\n' > "$B15/app/channel-server/dist/server.js"
OUT="$( export SHELL=/bin/zsh HOME="$H"; "$BASHX" "$B15/install.sh" --no-npm --plan "$T/u15.json" 2>&1 )"; I15=$?
SV2="$(sha_of "$CS/dist/server.js")"
sm undo --yes
[ $I15 -eq 0 ] && [ "$SV2" != "$SV1" ] && [ $RC -eq 0 ] && [ "$(sha_of "$CS/dist/server.js")" = "$SV1" ] && [ -f "$CS/node_modules/dep/i.js" ] \
  && [ "$(ls -d "$H/.slackmod/app/"*undo* 2>/dev/null | wc -l | tr -d ' ')" = 0 ] \
  && ok "⑮ bridge folder replaced by a second install → undo --yes: server.js = first one · node_modules/dep kept · no *undo* leftover" \
  || { no "⑮ install rc=$I15 undo rc=$RC nm $( [ -f "$CS/node_modules/dep/i.js" ] && echo kept || echo GONE)"; printf '%s\n' "$OUT" | tail -3; }

# ⑯ a watch folder that did not exist at «begin» (the wizard writes it before the install): undo removes the folders it made,
#    deepest first, only when empty — (a) folder and parent both missing · (b) parent there already (kept) · (c) a file the
#    person put in the made parent → that parent stays and is named
new_home; mk_setup "$T/u16a.json"; A16="$(kept)"
R16="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H/bots/lead" )"
mkdir -p "$H/bots/lead"; printf 'persona\n' > "$H/bots/lead/CLAUDE.md"
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R16"; "$BASHX" "$B/install.sh" --no-npm --plan "$T/u16a.json" 2>&1 )"; I16=$?
sm undo --yes
[ $I16 -eq 0 ] && [ $RC -eq 0 ] && [ "$(kept)" = "$A16" ] && [ ! -e "$H/bots" ] \
  && ok "⑯a watch ~/bots/lead missing at begin (and ~/bots) → undo --yes rc 0 · ~/bots gone · listing == before" \
  || { no "⑯a install rc=$I16 undo rc=$RC"; diff <(printf '%s\n' "$A16") <(kept) | head -6; }
new_home; mk_setup "$T/u16b.json"; mkdir -p "$H/bots"; A16="$(kept)"
R16="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H/bots/lead" )"
mkdir -p "$H/bots/lead"; printf 'persona\n' > "$H/bots/lead/CLAUDE.md"
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R16"; "$BASHX" "$B/install.sh" --no-npm --plan "$T/u16b.json" 2>&1 )"; I16=$?
sm undo --yes
[ $I16 -eq 0 ] && [ $RC -eq 0 ] && [ "$(kept)" = "$A16" ] && [ -d "$H/bots" ] && [ ! -e "$H/bots/lead" ] \
  && ok "⑯b ~/bots there already, ~/bots/lead missing at begin → undo --yes: ~/bots/lead gone · ~/bots kept · listing == before" \
  || { no "⑯b install rc=$I16 undo rc=$RC"; diff <(printf '%s\n' "$A16") <(kept) | head -6; }
new_home; mk_setup "$T/u16c.json"
R16="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H/bots/lead" )"
mkdir -p "$H/bots/lead"; printf 'persona\n' > "$H/bots/lead/CLAUDE.md"
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R16"; "$BASHX" "$B/install.sh" --no-npm --plan "$T/u16c.json" 2>&1 )"; I16=$?
printf 'my own\n' > "$H/bots/notes.txt"
sm undo --yes
[ $I16 -eq 0 ] && [ $RC -eq 0 ] && [ -f "$H/bots/notes.txt" ] && [ ! -e "$H/bots/lead" ] && printf '%s\n' "$OUT" | grep -F '남김' | grep -qF "$H/bots" \
  && ok "⑯c a person's file in the made ~/bots → undo --yes: ~/bots/lead gone · ~/bots kept with that file · named" \
  || { no "⑯c install rc=$I16 undo rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
# ⑰ the wizard order (SKILL 6 · 7-0): the record starts BEFORE setup.json is written and watches it as a file, so the
#   setup.json this run made goes on undo (a) · an older setup.json comes back byte for byte (b)
new_home; mk_setup "$T/u17.json"; A17="$(kept)"
R17="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H/bots/lead" --watch-file "$H/.slackmod/setup.json" )"
cp "$T/u17.json" "$H/.slackmod/setup.json"
mkdir -p "$H/bots/lead"; printf 'persona\n' > "$H/bots/lead/CLAUDE.md"
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R17"; "$BASHX" "$B/install.sh" --no-npm --plan "$H/.slackmod/setup.json" 2>&1 )"; I17=$?
sm undo --yes
[ $I17 -eq 0 ] && [ $RC -eq 0 ] && [ ! -e "$H/.slackmod/setup.json" ] && [ "$(kept)" = "$A17" ] \
  && ok "⑰a record begun before setup.json is written (--watch-file) → undo --yes rc 0 · setup.json gone · listing == before" \
  || { no "⑰a install rc=$I17 undo rc=$RC setup.json $( [ -e "$H/.slackmod/setup.json" ] && echo kept || echo gone)"; diff <(printf '%s\n' "$A17") <(kept) | head -6; }
new_home; mk_setup "$T/u17b.json"; mkdir -p "$H/.slackmod"; printf '{"old": true}\n' > "$H/.slackmod/setup.json"; S17="$(sha_of "$H/.slackmod/setup.json")"
R17="$( export HOME="$H"; python3 -I "$B/lib/record.py" begin --root "$H/.slackmod" --watch "$H/bots/lead" --watch-file "$H/.slackmod/setup.json" )"
cp "$T/u17b.json" "$H/.slackmod/setup.json"
mkdir -p "$H/bots/lead"; printf 'persona\n' > "$H/bots/lead/CLAUDE.md"
OUT="$( export SHELL=/bin/zsh HOME="$H" SLACKMOD_RECORD_DIR="$R17"; "$BASHX" "$B/install.sh" --no-npm --plan "$H/.slackmod/setup.json" 2>&1 )"; I17=$?
sm undo --yes
[ $I17 -eq 0 ] && [ $RC -eq 0 ] && [ "$(sha_of "$H/.slackmod/setup.json")" = "$S17" ] \
  && ok "⑰b an older setup.json, rewritten by this run → undo --yes rc 0 · the older setup.json back (same bytes)" \
  || no "⑰b install rc=$I17 undo rc=$RC"
finish
