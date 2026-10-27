#!/usr/bin/env bash
# open-terminal.sh — open a NEW terminal window that finishes the bot's setup where a human can type:
#   ① paste the two Slack tokens (hidden input — «slackmod set-token <bot>») ② if Claude Code is not logged in: say «/login» and
#   open claude so the person can ③ start the bot («slackmod start <bot>»). A tool call has no keyboard, so this step is a must.
#   bash open-terminal.sh <bot> [--dry-run]
# The first output line is always:   OPEN <backend> <command>      (<command> = what the new window runs)
# Which window opens (first match wins): herdr (HERDR_ENV=1: a new tab) · inside a tmux session ($TMUX: a new window) ·
# macOS (Terminal.app · iTerm2 when TERM_PROGRAM says so) · WSL (wt.exe new tab) · Linux (x-terminal-emulator) · none (the
# line to copy: «OPEN none …»). --dry-run (or MODS_SETUP_NO_OPEN=1) opens nothing and writes nothing — it only says what it would do.
# rc 0 opened (or dry-run) · 1 the backend failed (the line to paste is printed) · 2 bad bot name / not installed yet.
set -euo pipefail
BOT=""
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    -*) echo "모르는 옵션: $1" >&2; exit 2 ;;
    *) [ -z "$BOT" ] && BOT="$1" || { echo "봇 이름은 하나만" >&2; exit 2; }; shift ;;
  esac
done
[ "${MODS_SETUP_NO_OPEN:-0}" = 1 ] && DRY=1
[ -n "$BOT" ] || { echo "쓰는 법: open-terminal.sh <봇 이름> [--dry-run]" >&2; exit 2; }
printf '%s' "$BOT" | grep -qE '^[a-z][a-z0-9-]{0,31}$' || { echo "봇 이름은 소문자 영문으로 시작, 소문자·숫자·- 만: $BOT" >&2; exit 2; }
ROOT="${SLACKMOD_ROOT:-$HOME/.slackmod}"
case "$ROOT" in *\'*|*'
'*) echo "설치 폴더 경로에 작은따옴표·줄바꿈이 있으면 못 엽니다: $ROOT" >&2; exit 2 ;; esac
if [ ! -f "$ROOT/bots.list" ] || ! grep -qx -- "$BOT" "$ROOT/bots.list"; then
  echo "봇 «${BOT}» 이(가) 설치돼 있지 않습니다($ROOT/bots.list) — 설치(install.sh --plan)를 먼저 하세요" >&2
  exit 2
fi
SCRIPT="$ROOT/state/first-run-$BOT.sh"
CMD="sh '$SCRIPT'"

# what the new window runs (written only on a real run — state/ is outside the install fingerprint)
script_text() {
  cat <<EOS
#!/bin/sh
# made by open-terminal.sh — runs in the new window: tokens → login check → start $BOT
BOT='$BOT'
ROOT='$ROOT'
PATH="\$ROOT/bin:\$PATH"; export PATH
stay() { exec "\${SHELL:-sh}"; }
echo "== \$BOT 마무리: 토큰 넣기 → 로그인 확인 → 봇 켜기 =="
SLACKMOD_ROOT="\$ROOT" slackmod set-token "\$BOT" || { echo "토큰이 저장되지 않았습니다. 다시 하려면: slackmod set-token \$BOT"; stay; }
if command -v claude >/dev/null 2>&1 && ! claude auth status >/dev/null 2>&1; then
  echo
  echo "Claude Code 에 로그인이 안 돼 있습니다. 지금 claude 를 엽니다 — 화면이 뜨면 /login 을 입력해 로그인한 뒤 /exit 로 나오세요."
  claude || true
  claude auth status >/dev/null 2>&1 || { echo "로그인이 확인되지 않았습니다. 로그인한 뒤 다시: slackmod start \$BOT"; stay; }
fi
SLACKMOD_ROOT="\$ROOT" slackmod start "\$BOT" || stay
echo
echo "처음 켤 때 봇 창에 확인 화면(폴더 신뢰 · 권한 건너뛰기 경고)이 남아 있을 수 있습니다 — 그때는 아래 화살표로 «Yes» → Enter."
printf '봇 창을 지금 볼까요? Enter = 들어가기 (나오기 = Ctrl+b 뗀 뒤 d) · n = 건너뛰기: '
ans=n; read ans || ans=n
case "\$ans" in
  n|N|no) echo "나중에 보려면: slackmod attach \$BOT" ;;
  *) SLACKMOD_ROOT="\$ROOT" slackmod attach "\$BOT" ;;
esac
stay
EOS
}

# --- which backend ---
BACKEND=none
VIA=""
UNAME="$(uname -s 2>/dev/null || echo unknown)"
if [ "${HERDR_ENV:-}" = 1 ]; then
  BACKEND=herdr
  HBIN="${HERDR_BIN_PATH:-}"; case "$HBIN" in /*) ;; *) HBIN=herdr ;; esac
  VIA="$HBIN tab create --workspace ${HERDR_WORKSPACE_ID:-?} --cwd $HOME --label $BOT-setup  →  $HBIN pane run <새 탭의 pane> ' exec $CMD'"
elif [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
  BACKEND=tmux
  VIA="tmux new-window -n $BOT-setup \"$CMD\""
elif [ "$UNAME" = Darwin ] && command -v osascript >/dev/null 2>&1; then
  if [ "${TERM_PROGRAM:-}" = iTerm.app ]; then
    BACKEND=macos-iterm
    VIA="osascript: tell application \"iTerm2\" to create window with default profile command \"$CMD\""
  else
    BACKEND=macos-terminal
    VIA="osascript: tell application \"Terminal\" to do script \"$CMD\""
  fi
elif [ "$UNAME" = Linux ] && { [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; } && command -v wt.exe >/dev/null 2>&1; then
  BACKEND=wsl-wt
  VIA="wt.exe -w 0 new-tab --title $BOT-setup wsl.exe -d ${WSL_DISTRO_NAME:-Ubuntu} -- sh '$SCRIPT'"
elif [ "$UNAME" = Linux ] && command -v x-terminal-emulator >/dev/null 2>&1; then
  BACKEND=linux-terminal
  VIA="x-terminal-emulator -e sh '$SCRIPT'"
fi

echo "OPEN $BACKEND $CMD"
if [ "$BACKEND" = none ]; then
  echo "열 수 있는 터미널 창 도구를 못 찾았습니다. 새 터미널 창을 직접 열고 위 «OPEN none» 뒤의 한 줄을 붙여 넣으세요."
  echo "(그 창에서: 토큰 넣기 — 화면에 안 보임 → 로그인이 안 돼 있으면 /login → 봇 켜기)"
  if [ "$DRY" = 1 ]; then echo "(미리 보기 — 아무것도 안 씀)"; exit 0; fi
  mkdir -p "$ROOT/state"; script_text > "$SCRIPT"; chmod 755 "$SCRIPT"
  echo "(그 한 줄이 실행할 파일을 만들어 두었습니다: $SCRIPT)"
  exit 0
fi
echo "  방법: $VIA"
echo "  새 창이 할 일: ① slackmod set-token $BOT (붙여 넣어도 화면에 안 보임) ② 로그인 안 돼 있으면 /login 안내 ③ slackmod start $BOT"
if [ "$DRY" = 1 ]; then echo "(미리 보기 — 창을 열지도, 파일을 쓰지도 않았습니다)"; exit 0; fi

mkdir -p "$ROOT/state"
script_text > "$SCRIPT"; chmod 755 "$SCRIPT"
as_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
fail() { echo "열지 못했습니다($BACKEND) — 새 터미널 창에 이 한 줄을 붙여 넣으세요:  $CMD"; exit 1; }
case "$BACKEND" in
  herdr)
    OUTJ="$("$HBIN" tab create --workspace "${HERDR_WORKSPACE_ID:-}" --cwd "$HOME" --label "$BOT-setup" 2>/dev/null)" || fail
    PANE="$(printf '%s' "$OUTJ" | python3 -I -c 'import json,sys
try:
    print(json.loads(sys.stdin.read().strip().split("\n")[-1])["result"]["root_pane"]["pane_id"])
except Exception:
    pass' 2>/dev/null)"
    [ -n "$PANE" ] || fail
    "$HBIN" pane run "$PANE" " exec $CMD" >/dev/null 2>&1 || fail ;;
  tmux)
    tmux new-window -n "$BOT-setup" "$CMD" || fail ;;
  macos-terminal)
    osascript -e 'tell application "Terminal"' -e 'activate' -e "do script \"$(as_esc "$CMD")\"" -e 'end tell' >/dev/null || fail ;;
  macos-iterm)
    osascript -e 'tell application "iTerm2"' -e 'activate' -e "create window with default profile command \"$(as_esc "$CMD")\"" -e 'end tell' >/dev/null || fail ;;
  wsl-wt)
    wt.exe -w 0 new-tab --title "$BOT-setup" wsl.exe -d "${WSL_DISTRO_NAME:-Ubuntu}" -- sh "$SCRIPT" || fail ;;
  linux-terminal)
    x-terminal-emulator -e sh "$SCRIPT" || fail ;;
esac
echo "새 창을 열었습니다 ($BACKEND) — 그 창에서 안내대로 하세요."
