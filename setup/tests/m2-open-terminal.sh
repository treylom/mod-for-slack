#!/usr/bin/env bash
# m2-open-terminal.sh — open-terminal.sh <bot> [--dry-run]: backend choice (herdr · tmux · macOS Terminal/iTerm · WSL wt.exe · Linux ·
# none), the first line «OPEN <backend> <command>», what each backend is called with (FAKE environment variables and FAKE
# osascript / wt.exe / herdr / tmux / x-terminal-emulator on PATH — no real window is ever opened), --dry-run and
# MODS_SETUP_NO_OPEN = no call · no file; and the script the new window runs (tokens → login check → start), driven with fake
# slackmod / claude.
#   bash setup/tests/m2-open-terminal.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m2-open)"
trap 'rm -rf "$T"' EXIT
OT="$SETUP_DIR/lib/open-terminal.sh"
SYS="env bash sh grep sed awk cat mkdir chmod uname dirname basename python3 tr cut head tail ls rm"
fake() { printf '%s\n' "$2" > "$1"; chmod 755 "$1"; }
LOG="$T/calls.log"
# mk_env <dir> <uname> [tools…] — PATH dir with the system tools it needs + fakes that LOG their arguments
mk_env() {
  local d="$1" un="$2"; shift 2
  rm -rf "$d"; mkdir -p "$d"
  local s; for s in $SYS; do [ "$s" = uname ] && continue; ln -s "$(command -v "$s")" "$d/$s" 2>/dev/null; done
  fake "$d/uname" "#!/bin/sh
echo $un"
  for s in "$@"; do
    case "$s" in
      herdr) fake "$d/herdr" '#!/bin/sh
{ printf "herdr"; for a in "$@"; do printf " [%s]" "$a"; done; echo; } >> "$LOG"
if [ "$1" = tab ]; then echo "{\"result\":{\"root_pane\":{\"pane_id\":\"p1\",\"tab_id\":\"t1\",\"terminal_id\":\"x1\",\"workspace_id\":\"w1\"}}}"; fi' ;;
      tmux|osascript|wt.exe|x-terminal-emulator) fake "$d/$s" "#!/bin/sh
{ printf '$s'; for a in \"\$@\"; do printf ' [%s]' \"\$a\"; done; echo; } >> \"\$LOG\"
exit \${FAKE_RC:-0}" ;;
    esac
  done
}
# a fake installed bot: HOME with ~/.slackmod/bots.list
new_home() { HOME_T="$T/home.$RANDOM"; mkdir -p "$HOME_T/.slackmod/state"; printf 'lead\nwatch\n' > "$HOME_T/.slackmod/bots.list"; : > "$LOG"; }
# run_ot <PATH dir> <extra env assignments…> -- <args…> → OUT · RC
run_ot() {
  local pd="$1"; shift
  local envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  OUT="$(env -i HOME="$HOME_T" PATH="$pd" LOG="$LOG" SHELL=/bin/sh ${envs[@]+"${envs[@]}"} "$BASHX" "$OT" "$@" 2>&1)"; RC=$?
}
first() { printf '%s\n' "$OUT" | head -1; }
SCR() { printf '%s/.slackmod/state/first-run-%s.sh' "$HOME_T" "$1"; }

# ── backend choice (dry-run first: the first line + nothing called · nothing written) ──
sel_case() { # sel_case <label> <expected backend> <uname> <tools> -- <env assignments…>
  local label="$1" want="$2" un="$3" tools="$4"; shift 4; shift
  mk_env "$T/p" "$un" $tools; new_home
  local before; before="$(listing "$HOME_T")"
  run_ot "$T/p" "$@" -- lead --dry-run
  if [ $RC -eq 0 ] && printf '%s' "$(first)" | grep -qE "^OPEN $want sh '.*/\.slackmod/state/first-run-lead\.sh'$" && [ ! -s "$LOG" ] && [ "$(listing "$HOME_T")" = "$before" ]; then
    ok "$label → «$(first | cut -c1-60)…» · fake tool not called · HOME unchanged"
  else no "$label (want OPEN $want) rc=$RC first=«$(first)» calls=$(wc -l < "$LOG" | tr -d ' ')"; printf '%s\n' "$OUT" | head -4; fi
}
sel_case "no window tool at all (Linux, nothing)" none Linux "" --
sel_case "herdr pane (HERDR_ENV=1)" herdr Darwin "herdr osascript" -- HERDR_ENV=1 HERDR_WORKSPACE_ID=w1
sel_case "inside a tmux session" tmux Darwin "tmux osascript" -- TMUX=/tmp/fake-sock,1,0
sel_case "tmux env set but no tmux binary → falls through to macOS" macos-terminal Darwin "osascript" -- TMUX=/tmp/fake-sock,1,0
sel_case "macOS Terminal.app" macos-terminal Darwin "osascript" --
sel_case "macOS iTerm2 (TERM_PROGRAM=iTerm.app)" macos-iterm Darwin "osascript" -- TERM_PROGRAM=iTerm.app
sel_case "WSL (WSL_DISTRO_NAME + wt.exe)" wsl-wt Linux "wt.exe x-terminal-emulator" -- WSL_DISTRO_NAME=Ubuntu
sel_case "WSL variable but no wt.exe → Linux terminal" linux-terminal Linux "x-terminal-emulator" -- WSL_DISTRO_NAME=Ubuntu
sel_case "plain Linux (x-terminal-emulator)" linux-terminal Linux "x-terminal-emulator" --
sel_case "herdr beats tmux" herdr Linux "herdr tmux" -- HERDR_ENV=1 TMUX=/tmp/s,1,0
sel_case "tmux beats macOS" tmux Darwin "tmux osascript" -- TMUX=/tmp/s,1,0
sel_case "macOS without osascript → none" none Darwin "" --
mk_env "$T/p" Darwin osascript; new_home
run_ot "$T/p" MODS_SETUP_NO_OPEN=1 -- lead
[ $RC -eq 0 ] && [ ! -s "$LOG" ] && [ ! -e "$(SCR lead)" ] && printf '%s' "$OUT" | grep -q '미리 보기' && ok "MODS_SETUP_NO_OPEN=1 = dry-run: osascript not called · no script file" || no "NO_OPEN rc=$RC"

# ── real runs: what each backend is called with ──
mk_env "$T/p" Darwin herdr; new_home
run_ot "$T/p" HERDR_ENV=1 HERDR_WORKSPACE_ID=w1 -- lead
S="$(SCR lead)"
c1="$(sed -n 1p "$LOG")"; c2="$(sed -n 2p "$LOG")"
[ $RC -eq 0 ] && printf '%s' "$c1" | grep -q '^herdr \[tab\] \[create\] \[--workspace\] \[w1\] \[--cwd\] \[.*\] \[--label\] \[lead-setup\]$' && [ "$c2" = "herdr [pane] [run] [p1] [ exec sh '$S']" ] && [ -x "$S" ] \
  && ok "herdr real: tab create --workspace w1 --label lead-setup → pane run p1 ' exec sh <script>' (pane id read from the JSON answer)" || { no "herdr real rc=$RC"; cat "$LOG"; printf '%s\n' "$OUT" | tail -3; }
mk_env "$T/p" Darwin tmux; new_home
run_ot "$T/p" TMUX=/tmp/s,1,0 -- lead
S="$(SCR lead)"
[ $RC -eq 0 ] && [ "$(cat "$LOG")" = "tmux [new-window] [-n] [lead-setup] [sh '$S']" ] && ok "tmux real: new-window -n lead-setup \"sh '<script>'\"" || { no "tmux real rc=$RC"; cat "$LOG"; }
mk_env "$T/p" Darwin osascript; new_home
run_ot "$T/p" -- lead
S="$(SCR lead)"
if [ $RC -eq 0 ] && grep -q '\[tell application "Terminal"\]' "$LOG" && grep -qF "[do script \"sh '$S'\"]" "$LOG" && grep -q '\[activate\]' "$LOG"; then
  ok "macOS Terminal real: osascript tell application \"Terminal\" · activate · do script \"sh '<script>'\""
else no "mac terminal real rc=$RC"; cat "$LOG"; fi
new_home
run_ot "$T/p" TERM_PROGRAM=iTerm.app -- lead
grep -q '\[tell application "iTerm2"\]' "$LOG" && grep -qF "create window with default profile command \"sh '$(SCR lead)'\"" "$LOG" && ok "macOS iTerm real: tell application \"iTerm2\" · create window with default profile command \"sh '<script>'\"" || { no "iterm real"; cat "$LOG"; }
mk_env "$T/p" Linux wt.exe; new_home
run_ot "$T/p" WSL_DISTRO_NAME=Debian -- lead
[ $RC -eq 0 ] && [ "$(cat "$LOG")" = "wt.exe [-w] [0] [new-tab] [--title] [lead-setup] [wsl.exe] [-d] [Debian] [--] [sh] [$(SCR lead)]" ] && ok "WSL real: wt.exe -w 0 new-tab --title lead-setup wsl.exe -d Debian -- sh <script>" || { no "wsl real rc=$RC"; cat "$LOG"; }
mk_env "$T/p" Linux x-terminal-emulator; new_home
run_ot "$T/p" -- lead
[ $RC -eq 0 ] && [ "$(cat "$LOG")" = "x-terminal-emulator [-e] [sh] [$(SCR lead)]" ] && ok "Linux real: x-terminal-emulator -e sh <script>" || { no "linux real rc=$RC"; cat "$LOG"; }
# none, real: the script is made and the line to paste is printed
mk_env "$T/p" Linux ""; new_home
run_ot "$T/p" -- lead
[ $RC -eq 0 ] && [ -x "$(SCR lead)" ] && printf '%s' "$(first)" | grep -q "^OPEN none sh '" && printf '%s' "$OUT" | grep -q '붙여 넣으세요' && ok "none real: rc 0 · script made · «OPEN none sh '…'» + paste instruction" || { no "none real rc=$RC"; printf '%s\n' "$OUT"; }
# backend failure → rc 1 + the line to paste
mk_env "$T/p" Darwin osascript; new_home
run_ot "$T/p" FAKE_RC=1 -- lead
[ $RC -eq 1 ] && printf '%s' "$OUT" | grep -q "붙여 넣으세요:  sh '" && ok "osascript fails → rc 1 · prints the line to paste (sh '<script>')" || { no "backend failure rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# the only file a real run writes = state/first-run-<bot>.sh (nothing else in HOME)
mk_env "$T/p" Darwin osascript; new_home
run_ot "$T/p" -- watch
added="$(listing "$HOME_T" | grep -v -e 'bots.list' -e '^\./\.slackmod$' -e '^\./\.slackmod/state$' | sed 's/ .*//')"
[ "$added" = "./.slackmod/state/first-run-watch.sh" ] && [ "$(mode_of "$(SCR watch)")" = 755 ] && ok "a real run writes exactly one file: ~/.slackmod/state/first-run-watch.sh (0755) — outside the install fingerprint" || { no "files written: $added"; }
# input errors
new_home
mk_env "$T/p" Darwin osascript
run_ot "$T/p" -- 'Bad Name' --dry-run; r1=$RC
run_ot "$T/p" -- ghost --dry-run; r2=$RC; o2="$OUT"
run_ot "$T/p" -- ; r3=$RC
run_ot "$T/p" -- lead --bogus; r4=$RC
rm "$HOME_T/.slackmod/bots.list"; run_ot "$T/p" -- lead --dry-run; r5=$RC
[ $r1 -eq 2 ] && [ $r2 -eq 2 ] && printf '%s' "$o2" | grep -q '설치돼 있지 않습니다' && [ $r3 -eq 2 ] && [ $r4 -eq 2 ] && [ $r5 -eq 2 ] && [ ! -s "$LOG" ] && ok "input errors (bad name · bot not installed · no bot · unknown option · no bots.list) → rc 2 each · nothing called" || no "input errors $r1 $r2 $r3 $r4 $r5"

# ── the script the new window runs: fake slackmod / claude ──
drive() { # drive <claude-logged-in 0|1> <set-token rc> <claude-login-works 0|1> [what the person types, printf %b] → runs the generated script; CALLS · SRC_OUT
  local li="$1" strc="$2" lw="$3" typed="${4:-}"
  mk_env "$T/p" Darwin osascript; new_home
  run_ot "$T/p" -- lead > /dev/null 2>&1
  local S; S="$(SCR lead)"
  mkdir -p "$HOME_T/.slackmod/bin" "$T/fb"
  CALLS="$T/script-calls.log"; : > "$CALLS"
  fake "$HOME_T/.slackmod/bin/slackmod" "#!/bin/sh
echo \"slackmod \$*\" >> \"$CALLS\"
case \"\$1\" in set-token) exit $strc ;; esac
exit 0"
  rm -f "$T/fb/loggedin"; [ "$li" = 1 ] && : > "$T/fb/loggedin"
  fake "$T/fb/claude" "#!/bin/sh
if [ \"\$1\" = auth ]; then echo \"claude auth \$*\" >> \"$CALLS\"; [ -f \"$T/fb/loggedin\" ]; exit \$?; fi
echo \"claude (interactive)\" >> \"$CALLS\"
[ $lw = 1 ] && : > \"$T/fb/loggedin\"
exit 0"
  fake "$T/fb/shell" '#!/bin/sh
exit 0'
  SRC_OUT="$(printf '%b' "$typed" | env -i HOME="$HOME_T" PATH="$T/fb:$T/p" SHELL="$T/fb/shell" "$BASHX" -c "sh '$S'" 2>&1)"
}
drive 1 0 1
sh -n "$(SCR lead)" 2>/dev/null && [ "$(cat "$CALLS")" = "slackmod set-token lead
claude auth auth status
slackmod start lead" ] && ok "window script, logged in: set-token → auth status → start (claude never opened)" || { no "script logged-in"; cat "$CALLS"; }
drive 0 0 1
[ "$(cat "$CALLS")" = "slackmod set-token lead
claude auth auth status
claude (interactive)
claude auth auth status
slackmod start lead" ] && printf '%s' "$SRC_OUT" | grep -q '/login' && ok "window script, not logged in: tells «/login» · opens claude · re-checks · then start" || { no "script login flow"; cat "$CALLS"; printf '%s\n' "$SRC_OUT"; }
drive 0 0 0
[ "$(cat "$CALLS")" = "slackmod set-token lead
claude auth auth status
claude (interactive)
claude auth auth status" ] && printf '%s' "$SRC_OUT" | grep -q '로그인이 확인되지 않았습니다' && ok "window script, login still missing: NO start · says so" || { no "script login fail"; cat "$CALLS"; }
drive 1 1 1
[ "$(cat "$CALLS")" = "slackmod set-token lead" ] && printf '%s' "$SRC_OUT" | grep -q '토큰이 저장되지 않았습니다' && ok "window script, set-token fails: stops there (no login check · no start)" || { no "script token fail"; cat "$CALLS"; }
# K19: after start, the window offers the bot window (a first-start screen may wait there) · Enter = in · n = skip · no input = skip
drive 1 0 1 '\n'
[ "$(cat "$CALLS")" = "slackmod set-token lead
claude auth auth status
slackmod start lead
slackmod attach lead" ] && printf '%s' "$SRC_OUT" | grep -q '봇 창을 지금 볼까요' && ok "window script, Enter after start: slackmod attach lead (the first-start screens are picked there)" || { no "script attach on Enter"; cat "$CALLS"; printf '%s\n' "$SRC_OUT"; }
drive 1 0 1 'n\n'
[ "$(cat "$CALLS")" = "slackmod set-token lead
claude auth auth status
slackmod start lead" ] && printf '%s' "$SRC_OUT" | grep -q 'slackmod attach lead' && ok "window script, «n» after start: no attach · the line to do it later is shown" || { no "script attach skip"; cat "$CALLS"; printf '%s\n' "$SRC_OUT"; }
# the generated script holds no secret and only the bot name / root path
! grep -qE 'xox|xapp|sk-' "$(SCR lead)" && grep -q "^BOT='lead'$" "$(SCR lead)" && ok "window script: no token-shaped text · BOT='lead' fixed" || no "script content"
finish
