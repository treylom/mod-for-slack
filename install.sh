#!/usr/bin/env bash
# install.sh — 공개 저장소의 설치 진입(한 줄): 바탕을 점검하고, 빠진 것은 «깔 줄»만 보여 준 뒤, Claude Code 안에서 설치 마법사를 연다.
#   bash install.sh                       점검 → 마법사 시작(질문에 답하며 고르고 한 번에 설치)
#   bash install.sh --answers FILE        마법사에 미리 적어 둔 답 파일을 줌(묻지 않고 그 파일대로 설치)
#   bash install.sh --section NAME        마법사의 한 칸만 다시(예: slack)
#   bash install.sh --resume              마법사에서 «나중에»로 미룬 칸만 이어서(업무 묻기 · 작업 폴더 · 추천 …)
#   bash install.sh --no-launch           점검만(마법사를 열지 않음) — rc 0 = 바탕 갖춤 · 3 = 먼저 깔 것 있음
# 이 스크립트는 아무것도 설치하지 않고 sudo 도 부르지 않는다(필요한 줄만 보여 줌). 홈 폴더에 쓰는 것 0.
# 저장소 배치 두 가지에서 같이 돈다: ① 공개판 <뿌리>/install.sh · setup/ · slackmod/(설치 본체) ② 개발판 <뿌리>/port/(설치 본체).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ANSWERS=""
SECTION=""
LAUNCH=1
RESUME=0
while [ $# -gt 0 ]; do
  case "$1" in
    --answers) ANSWERS="${2:?--answers FILE}"; shift 2 ;;
    --section) SECTION="${2:?--section NAME}"; shift 2 ;;
    --resume) RESUME=1; shift ;;
    --no-launch) LAUNCH=0; shift ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done
say() { printf '%s\n' "$*"; }
[ -d "$ROOT/setup/.claude-plugin" ] || { echo "설치 마법사 플러그인이 없습니다: $ROOT/setup/.claude-plugin — 저장소를 다시 받으세요" >&2; exit 2; }
INSTALLER=""
for c in "$ROOT/slackmod/install.sh" "$ROOT/port/install.sh"; do [ -f "$c" ] && { INSTALLER="$c"; break; }; done
[ -n "$INSTALLER" ] || { echo "설치 본체(slackmod/install.sh)를 못 찾았습니다 — 저장소를 다시 받으세요" >&2; exit 2; }
if [ -n "$ANSWERS" ]; then
  [ -f "$ANSWERS" ] || { echo "--answers 파일이 없습니다: $ANSWERS" >&2; exit 2; }
  ANSWERS="$(cd "$(dirname "$ANSWERS")" && pwd -P)/$(basename "$ANSWERS")"
fi
if [ "$RESUME" = 1 ] && { [ -n "$ANSWERS" ] || [ -n "$SECTION" ]; }; then echo "--resume 은 --answers · --section 과 같이 쓰지 않습니다" >&2; exit 2; fi
if [ -n "$SECTION" ] && ! printf '%s' "$SECTION" | grep -qE '^[a-z][a-z0-9-]*$'; then echo "--section 이름은 소문자로 시작, 소문자·숫자·- 만: $SECTION" >&2; exit 2; fi

# ── 바탕 점검 ────────────────────────────────────────────────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  MINGW*|MSYS*|CYGWIN*|Windows*)
    say "윈도우(PowerShell · 명령 프롬프트 · Git Bash)에서는 봇이 바로 돌지 않습니다 — 봇은 윈도우 안의 리눅스(WSL · Ubuntu)에서 돕니다."
    say "  ① WSL 과 Claude Code 가 아직 없으면: 윈도우용 한 번에 깔기 설치기로 먼저 설치하고 오세요 — 이 저장소 README 의 «Claude Code 먼저 깔기» 절"
    say "  ② 다 깔았으면: 시작 메뉴에서 «Ubuntu» 를 열고, 그 창 안에서 이 저장소를 받아 bash install.sh 를 다시 실행하세요"
    exit 3 ;;
  *) say "이 컴퓨터($OS)에서는 바로 못 돌립니다. Windows 는 WSL(Ubuntu) 터미널 안에서 이 설치기를 실행하세요."; exit 3 ;;
esac
WSL=0
if [ "$OS" = Linux ] && grep -qi microsoft /proc/version 2>/dev/null; then WSL=1; fi
SHELL_NAME="$(basename "${SHELL:-sh}")"
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
[ -n "$CLAUDE_BIN" ] || { [ -x "$HOME/.local/bin/claude" ] && CLAUDE_BIN="$HOME/.local/bin/claude"; } || true
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
fi
NODE_MAJOR=0
[ -n "$NODE_BIN" ] && NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
PY_BIN="$(command -v python3 2>/dev/null || true)"
GIT_BIN="$(command -v git 2>/dev/null || true)"
MUX_FOUND=""
for t in tmux cmux herdr; do
  command -v "$t" >/dev/null 2>&1 && MUX_FOUND="${MUX_FOUND:+$MUX_FOUND }$t"
done
CLAUDE_VER=""
[ -n "$CLAUDE_BIN" ] && CLAUDE_VER="$("$CLAUDE_BIN" --version 2>/dev/null | awk '{print $1}' || true)"

say "MOD 설치 점검 — $ROOT"
say "  OS       $OS$( [ "$WSL" = 1 ] && printf ' (WSL)') · 셸 $SHELL_NAME"
say "  claude   ${CLAUDE_BIN:-(없음)}${CLAUDE_VER:+ · 판 $CLAUDE_VER}"
say "  node     ${NODE_BIN:-(없음)}$( [ -n "$NODE_BIN" ] && printf ' · %s' "$NODE_MAJOR" )"
say "  python3  ${PY_BIN:-(없음)}"
say "  git      ${GIT_BIN:-(없음)}"
say "  창 도구  ${MUX_FOUND:-(없음 — tmux · cmux · herdr 중 하나 필요)}"
case "$SHELL_NAME" in zsh|bash) ;; *) say "  주의     셸이 $SHELL_NAME — 켜기 이름(별칭)은 bash 꼴로 ~/.bashrc 에 들어갑니다(zsh 면 ~/.zshrc)." ;; esac

SUDO_PKGS=""
USER_LINES=""
addpkg() { SUDO_PKGS="${SUDO_PKGS:+$SUDO_PKGS }$1"; }
addline() { USER_LINES="${USER_LINES}$1"$'\n'; }
BAD=0
[ -n "$PY_BIN" ] || { BAD=1; if [ "$OS" = Darwin ]; then addpkg python; else addpkg python3; fi; }
[ -n "$GIT_BIN" ] || { BAD=1; addpkg git; }
[ -n "$MUX_FOUND" ] || { BAD=1; addpkg tmux; }
if [ "$OS" = Linux ]; then command -v curl >/dev/null 2>&1 || { BAD=1; addpkg curl; }; fi
# the bundle installer (slackmod/install.sh) also needs uuidgen on Linux — list it here so the wizard does not stop at the end
if [ "$OS" = Linux ]; then command -v uuidgen >/dev/null 2>&1 || { BAD=1; addpkg uuid-runtime; }; fi
if [ -z "$NODE_BIN" ] || ! [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
  BAD=1
  addline "  [sudo 없이 — node 20 이상${NODE_BIN:+ (지금 $NODE_MAJOR)}]"
  addline "    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  addline "    (새 터미널을 연 뒤) nvm install 22"
fi
if [ -z "$CLAUDE_BIN" ]; then
  BAD=1
  # 이 설치 도우미는 «Claude Code 가 이미 깔린 사람»을 전제로 한다(셸은 무엇이든) — 없으면 먼저 깔고 오도록 안내만 한다
  addline "  [Claude Code 가 없습니다 — 먼저 설치하고 오세요]"
  addline "    안내: $ROOT/README.md 의 «Claude Code 먼저 깔기» 절"
  addline "    맥·리눅스·WSL 에서 바로 깔려면(sudo 없이): curl -fsSL https://claude.ai/install.sh | bash"
  addline "    (설치 뒤 한 번) claude   ← 로그인 · 그다음 이 설치기를 다시 실행"
fi
if [ "$BAD" = 1 ]; then
  say ""
  say "먼저 깔아야 할 것이 있습니다 (이 설치기는 아무것도 깔지 않고 줄만 보여 줍니다)."
  if [ -n "$SUDO_PKGS" ]; then
    if [ "$OS" = Darwin ]; then
      command -v brew >/dev/null 2>&1 || say "  [Homebrew 가 없습니다 — https://brew.sh 의 한 줄을 먼저]"
      say "  [관리자 권한이 필요할 수 있음]"
      say "    brew install $SUDO_PKGS"
    else
      say "  [sudo 묶음 — 관리자 비밀번호 1번 · 이 한 줄만 sudo]"
      say "    sudo apt-get update && sudo apt-get install -y $SUDO_PKGS ca-certificates"
    fi
  fi
  [ -z "$USER_LINES" ] || printf '%s' "$USER_LINES"
  say "다 깐 뒤 이 설치기를 다시 실행하세요: bash $ROOT/install.sh"
  exit 3
fi
say "  → 바탕 점검 통과"
if [ "$LAUNCH" = 0 ]; then say "(--no-launch: 마법사는 열지 않았습니다)"; exit 0; fi

# ── 마법사 시작 ───────────────────────────────────────────────────────────────────────────────────────────────────────
PROMPT="/mods-setup:setup"
[ -z "$ANSWERS" ] || PROMPT="$PROMPT --answers $ANSWERS"
[ -z "$SECTION" ] || PROMPT="$PROMPT --section $SECTION"
[ "$RESUME" = 0 ] || PROMPT="$PROMPT --resume"
say ""
say "Claude Code 안에서 설치 마법사를 엽니다 — 처음 한 번 «이 폴더를 믿겠습니까?» 창이 뜨면 아래 화살표로 «Yes» 를 고른 뒤 Enter (그냥 Enter 는 «No, exit»(나가기)입니다)."
say "  $CLAUDE_BIN --plugin-dir $ROOT/setup \"$PROMPT\""
exec env MODS_SETUP_REPO="$ROOT" "$CLAUDE_BIN" --plugin-dir "$ROOT/setup" "$PROMPT"
