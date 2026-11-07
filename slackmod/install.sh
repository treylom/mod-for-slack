#!/usr/bin/env bash
# mod-for-slack 최소판 설치기 — WSL(Ubuntu) · macOS. 같은 걸 두 번 실행해도 결과가 같다(두 번째 = «바뀜 0»).
#   bash install.sh --dry-run     바꿀 것만 보여 줌 (쓰기 0)
#   bash install.sh               설치 · 갱신
# 옵션: --config FILE (기본 ~/.slackmod/config.json) · --rc FILE (기본: 셸이 zsh 면 ~/.zshrc · 아니면 ~/.bashrc) · --no-npm (시험용 — 채널 서버 의존성 설치 건너뜀)
#       --plan FILE  설치 마법사가 만든 setup.json 으로 설정 파일을 만들거나 맞춘 뒤 그대로 설치(설정 칸을 손으로 안 채움) ·
#                    rc 0 성공 · 2 입력 오류(setup 파일 고치기) · 3 먼저 깔 것 있음 · 4 설정 채움 필요(--plan 없이 처음 돌릴 때)
# 바꾸는 파일·폴더는 먼저 ~/.slackmod/backup/<시각>/ 에 옮겨 둔다. sudo 는 이 스크립트가 부르지 않는다(필요한 줄만 따로 묶어 보여 줌).
# 토큰은 이 스크립트가 묻지도 출력하지도 않는다 → 설치 뒤 «slackmod set-token <봇>».
# 되돌리기: 바꾼 것마다 ~/.slackmod/state/installs/<시각>/ 에 기록(lib/record.py) → «slackmod undo» 가 방금 설치 하나를 되돌림.
#   환경 변수 SLACKMOD_RECORD_DIR = 마법사가 «record.py begin» 으로 먼저 연 기록 폴더(없으면 이 설치기가 연다 · 봇 slack/.env 는 기록 안 함)
set -euo pipefail
umask 022
BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$HOME/.slackmod"
CONFIG=""
RC_FILE=""
PLAN_FILE=""
DRY=0
NPM_STEP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --config) CONFIG="${2:?--config FILE}"; shift 2 ;;
    --rc) RC_FILE="${2:?--rc FILE}"; shift 2 ;;
    --plan) PLAN_FILE="${2:?--plan FILE}"; shift 2 ;;
    --no-npm) NPM_STEP=0; shift ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CONFIG" ] || CONFIG="$ROOT/config.json"
# 켜기 이름을 넣을 셸 설정 파일: --rc 가 우선 · 아니면 로그인 셸이 zsh(macOS 기본)면 ~/.zshrc · 그 밖(bash · 모름)은 ~/.bashrc
if [ -z "$RC_FILE" ]; then
  case "${SHELL:-}" in
    */zsh|zsh) RC_FILE="$HOME/.zshrc" ;;
    *) RC_FILE="$HOME/.bashrc" ;;
  esac
fi
if [ -n "$PLAN_FILE" ] && [ ! -f "$PLAN_FILE" ]; then echo "--plan 파일이 없습니다: $PLAN_FILE" >&2; exit 2; fi
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$ROOT/backup/$STAMP"
CHANGED=0
SAME=0
WORK="$(mktemp -d "${TMPDIR:-/tmp}/slackmod-install.XXXXXX")"
REC=""          # this run's record folder (undo) · empty = not recording (preview · a kit without lib/record.py)
REC_DONE=0
rec_finish() { # the record's «after» fingerprints + R/state/installs/last — at the end, and also when the run stops half way
  [ -n "$REC" ] && [ "$REC_DONE" = 0 ] || return 0
  REC_DONE=1
  "$PY_BIN" -I "$BUNDLE/lib/record.py" finish --root "$ROOT" --dir "$REC" --config "$CONFIG" || say "  주의    되돌리기 기록을 마치지 못했습니다($REC)"
}
trap 'rec_finish; rm -rf "$WORK"' EXIT

say() { printf '%s\n' "$*"; }
rec() { # rec <kind> <path> [backup] [mode before] — one line of this run's record (kind = new · changed · tree · dir-new · rc)
  [ -n "$REC" ] || return 0
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "${3:-}" "${4:-}" >> "$REC/install.tsv"
}
mkdir_rec() { # mkdir_rec <dir> — mkdir -p, recording every folder it makes (outermost first: undo removes them innermost first)
  local x="$1" made=()
  while [ -n "$x" ] && [ "$x" != / ] && [ ! -e "$x" ] && [ ! -L "$x" ]; do made=("$x" ${made[@]+"${made[@]}"}); x="$(dirname "$x")"; done
  mkdir -p "$1"
  for x in ${made[@]+"${made[@]}"}; do rec dir-new "$x"; done
}
act() { # act <KIND> <what> — KIND = SAME | WRITE | DIR | RUN | COPY
  if [ "$1" = SAME ]; then SAME=$((SAME + 1)); say "  그대로   $2"; return; fi
  CHANGED=$((CHANGED + 1))
  if [ "$DRY" = 1 ]; then say "  할 일    [$1] $2"; else say "  바꿈     [$1] $2"; fi
}
sha_file() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mode_of() { if stat -c %a "$1" >/dev/null 2>&1; then stat -c %a "$1"; else stat -f %Lp "$1"; fi; }
rel_home() { case "$1" in "$HOME"/*) printf '%s' "${1#"$HOME"/}" ;; *) printf 'abs%s' "$1" ;; esac; }
backup_path() { # move or copy one existing path into this run's backup folder
  local p="$1" how="$2" dst
  dst="$BACKUP/$(rel_home "$p")"
  mkdir -p "$(dirname "$dst")"
  if [ "$how" = move ]; then mv "$p" "$dst"; else cp -pR "$p" "$dst"; fi
  chmod -R go-rwx "$dst" 2>/dev/null || true   # a backup is never more readable than the owner alone (an old launch.sh / config may hold values)
}
ensure_dir() { # ensure_dir <dir> <mode>
  if [ -d "$1" ]; then
    if [ "$(mode_of "$1")" != "$2" ]; then act WRITE "권한 $2 $1"; [ "$DRY" = 1 ] || chmod "$2" "$1"; else SAME=$((SAME + 1)); fi
  else
    act DIR "$1"; [ "$DRY" = 1 ] || { mkdir_rec "$1"; chmod "$2" "$1"; }
  fi
}
put_file() { # put_file <target> <mode> <source file>
  local t="$1" m="$2" s="$3" before=""
  if [ -f "$t" ] && cmp -s "$s" "$t" && [ "$(mode_of "$t")" = "$m" ]; then act SAME "$t"; return; fi
  act WRITE "$t"
  [ "$DRY" = 1 ] && return
  mkdir_rec "$(dirname "$t")"
  if [ -e "$t" ]; then before="$(mode_of "$t")"; backup_path "$t" copy; fi
  local tmp
  tmp="$(mktemp "$t.slackmod-tmp.XXXXXX")"   # a fresh owner-only file: never a name planted beforehand (a repo can commit a link)
  cp "$s" "$tmp"
  chmod "$m" "$tmp"
  mv -f "$tmp" "$t"
  # the record keeps the mode it had: a backup is owner-only (backup_path), undo puts the old mode back
  if [ -n "$before" ]; then rec changed "$t" "$BACKUP/$(rel_home "$t")" "$before"; else rec new "$t"; fi
}

# ── 0. 바탕 점검 ─────────────────────────────────────────────────────────────────────────────────────────────────────
say "mod-for-slack 설치기 — $( [ "$DRY" = 1 ] && echo '미리 보기(쓰기 0)' || echo '설치') · 대상 $ROOT"
OS="$(uname -s)"
WSL=0
if [ "$OS" = Linux ] && grep -qi microsoft /proc/version 2>/dev/null; then WSL=1; fi
PIN="$(tr -d ' \n' < "$BUNDLE/app/mods-harness/.claude-code-version" 2>/dev/null || true)"
[ -d "$BUNDLE/app/mods-harness" ] && [ -d "$BUNDLE/app/channel-server" ] \
  || { echo "묶음이 온전하지 않습니다: $BUNDLE/app 아래 mods-harness · channel-server 가 있어야 합니다" >&2; exit 2; }

MISS_SUDO=()
MISS_USER=()
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
[ -n "$CLAUDE_BIN" ] || { [ -x "$HOME/.local/bin/claude" ] && CLAUDE_BIN="$HOME/.local/bin/claude"; } || true
TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
PY_BIN="$(command -v python3 2>/dev/null || true)"
SH_BIN="$(command -v sh 2>/dev/null || true)"
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
fi
NODE_MAJOR=0
[ -n "$NODE_BIN" ] && NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ -n "$TMUX_BIN" ] || MISS_SUDO+=(tmux)
[ -n "$PY_BIN" ] || MISS_SUDO+=(python3)
if [ "$OS" = Linux ] && ! command -v uuidgen >/dev/null 2>&1; then MISS_SUDO+=(uuid-runtime); fi
command -v curl >/dev/null 2>&1 || MISS_SUDO+=(curl)
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || MISS_USER+=(node)
[ -n "$CLAUDE_BIN" ] || MISS_USER+=(claude)
say "  claude  ${CLAUDE_BIN:-(없음)}$( [ -n "$CLAUDE_BIN" ] && printf ' · 판 %s' "$("$CLAUDE_BIN" --version 2>/dev/null | awk '{print $1}')" )"
say "  node    ${NODE_BIN:-(없음)} · tmux ${TMUX_BIN:-(없음)} · python3 ${PY_BIN:-(없음)} · WSL $WSL"
if [ -n "$CLAUDE_BIN" ] && [ -n "$PIN" ]; then
  HAVE="$("$CLAUDE_BIN" --version 2>/dev/null | awk '{print $1}')"
  [ "$HAVE" = "$PIN" ] || say "  주의    Claude Code 판이 맞춘 판($PIN)과 다릅니다(지금 $HAVE). 맞추려면: $CLAUDE_BIN install $PIN"
fi
if [ "${#MISS_SUDO[@]}" -gt 0 ] || [ "${#MISS_USER[@]}" -gt 0 ]; then
  say ""
  say "먼저 깔아야 할 것이 있습니다 (빠진 것: ${MISS_SUDO[*]:-} ${MISS_USER[*]:-})"
  if [ "${#MISS_SUDO[@]}" -gt 0 ]; then
    say "  [sudo 묶음 — 관리자 비밀번호 1번 · 이 한 줄만 sudo]"
    if [ "$OS" = Darwin ]; then say "    brew install ${MISS_SUDO[*]}"
    else say "    sudo apt-get update && sudo apt-get install -y ${MISS_SUDO[*]} ca-certificates"; fi
  fi
  for m in "${MISS_USER[@]:-}"; do
    case "$m" in
      node) say "  [sudo 없이 — node 20 이상]"
            say "    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
            say "    (새 터미널을 연 뒤) nvm install 22" ;;
      claude) say "  [sudo 없이 — Claude Code ${PIN:-}]"
              say "    curl -fsSL https://claude.ai/install.sh | bash -s ${PIN:-stable}"
              say "    (설치 뒤 한 번) claude   ← 로그인" ;;
    esac
  done
  say "다 깐 뒤 이 설치기를 다시 실행하세요."
  [ -n "$PY_BIN" ] || exit 3
  [ "$DRY" = 1 ] || exit 3
  say "(미리 보기는 빠진 것을 «(없음)» 으로 둔 채 계속합니다)"
fi
CFG_PY=("$PY_BIN" -I "$BUNDLE/lib/slackmod_config.py")

# ── 1. 설정 파일 ─────────────────────────────────────────────────────────────────────────────────────────────────────
say ""
say "1) 설정 파일 $CONFIG"
CONFIG_USE="$CONFIG"
if [ -n "$PLAN_FILE" ]; then
  # --plan: 마법사의 setup.json 이 원본 — 설정 파일은 거기서 만든다(예전 설정의 별칭 이름 · 하위 세션 기본값 · 알림 스위치 ·
  # 봇별 모델/Slack ID 는 그대로 이어 받음). 같은 setup.json 을 다시 주면 같은 설정 = «그대로».
  BASEARGS=()
  [ -f "$CONFIG" ] && BASEARGS=(--base "$CONFIG")
  if ! "${CFG_PY[@]}" from-setup --setup "$PLAN_FILE" --home "$HOME" ${BASEARGS[@]+"${BASEARGS[@]}"} > "$WORK/config.from-setup" 2> "$WORK/from-setup.err"; then
    { say "  setup 파일($PLAN_FILE)에 고칠 곳이 있습니다 — 고친 뒤 다시 실행하세요:"; cat "$WORK/from-setup.err"; } >&2
    exit 2
  fi
  CONFIG_USE="$WORK/config.from-setup"   # 쓰는 것은 아래에서 «미리 계산»이 통과한 뒤
elif [ ! -f "$CONFIG" ]; then
  act COPY "예시 설정 → $CONFIG"
  if [ "$DRY" = 0 ]; then
    mkdir -p "$(dirname "$CONFIG")"
    cp "$BUNDLE/config.example.json" "$CONFIG"
    chmod 644 "$CONFIG"
  fi
  say "  설정 파일의 X 자리(채널 ID · 사용자 ID)와 봇 폴더를 채운 뒤 이 설치기를 다시 실행하세요:"
  say "    nano $CONFIG"
  [ "$DRY" = 1 ] && exit 0 || exit 4
fi
if ! "${CFG_PY[@]}" validate --config "$CONFIG_USE"; then
  say "  설정을 고친 뒤 다시 실행하세요 (위 줄마다 한 곳)."
  [ -n "$PLAN_FILE" ] && exit 2
  exit 4
fi
act SAME "설정 확인 통과"
# 여는 말(children_open): contract.md = 틀 그대로 — 설정에 기본 아닌 여는 말이 있을 때만 그 한 줄의 «» 안 글이 바뀐다(contract-solo.md 는 늘 틀 그대로).
# 아무것도 쓰기 전에 만들어 둔다(틀에 그 줄이 없으면 여기서 멈춤 · rc 2 · 손 안 댐).
if ! "${CFG_PY[@]}" render-contract --config "$CONFIG_USE" --template "$BUNDLE/templates/main-contract.md" > "$WORK/contract.md" 2> "$WORK/contract.err"; then
  { say "  봇 규칙 글(contract.md)을 만들 수 없습니다 — 아무것도 바꾸지 않았습니다:"; cat "$WORK/contract.err"; } >&2
  exit 2
fi
# (record.py: a kit made before it has none → installs as before, without an undo record)
HAVE_REC=0; [ -f "$BUNDLE/lib/record.py" ] && HAVE_REC=1
# 봇마다 만들 파일을 «아무것도 쓰기 전에» 미리 계산한다 — 합칠 기존 파일(봇 폴더 .claude/settings.json · .mcp.json)이 깨져 있으면
# 여기서 멈추므로 반쯤 설치된 상태가 남지 않는다(rc 2 · 손 안 댐).
mkdir -p "$WORK/stage"
PASS_SHA="$(sha_file "$BUNDLE/hooks/pass.sh")"
if ! "${CFG_PY[@]}" plan-stage --config "$CONFIG_USE" --stage "$WORK/stage" --root "$ROOT" \
     --python "${PY_BIN}" --node "${NODE_BIN:-/usr/bin/node}" --claude "${CLAUDE_BIN:-$HOME/.local/bin/claude}" \
     --sh "${SH_BIN:-/bin/sh}" --pass-sha "$PASS_SHA" > "$WORK/plan.tsv" 2> "$WORK/plan.err"; then
  { say "  봇 폴더의 기존 파일을 합칠 수 없습니다 — 아무것도 바꾸지 않았습니다. 고친 뒤 다시 실행하세요:"; cat "$WORK/plan.err"; } >&2
  exit 2
fi
# 되돌리기 기록 — the first write is below this line. The wizard may have opened the record already (record.py begin --watch …,
# SLACKMOD_RECORD_DIR) so that what it wrote before the install is undone too · otherwise one is opened here.
if [ "$DRY" = 0 ] && [ "$HAVE_REC" = 1 ]; then
  if [ -n "${SLACKMOD_RECORD_DIR:-}" ]; then
    case "$SLACKMOD_RECORD_DIR" in
      "$ROOT/state/installs/"*) [ -d "$SLACKMOD_RECORD_DIR" ] && REC="$SLACKMOD_RECORD_DIR" ;;
    esac
    [ -n "$REC" ] || say "  주의    SLACKMOD_RECORD_DIR 가 $ROOT/state/installs/ 아래 기록 폴더가 아닙니다 — 새 기록을 엽니다"
  fi
  [ -n "$REC" ] || REC="$("$PY_BIN" -I "$BUNDLE/lib/record.py" begin --root "$ROOT" --stamp "$STAMP")" || REC=""
fi
# a config that carries secret-named extra_env values is owner-only (the values are copied to the bot's own .env below)
CFG_MODE=644; grep -q '^ENVSEC' "$WORK/plan.tsv" && CFG_MODE=600
if [ -n "$PLAN_FILE" ]; then put_file "$CONFIG" "$CFG_MODE" "$WORK/config.from-setup"
elif [ "$CFG_MODE" = 600 ] && [ -f "$CONFIG" ] && [ "$(mode_of "$CONFIG")" != 600 ]; then
  act WRITE "권한 600 $CONFIG (비밀 닮은 이름의 값이 들어 있음)"
  if [ "$DRY" = 0 ]; then
    m0="$(mode_of "$CONFIG")"; backup_path "$CONFIG" copy; rec changed "$CONFIG" "$BACKUP/$(rel_home "$CONFIG")" "$m0"
    chmod 600 "$CONFIG"
  fi
fi

# ── 2. 폴더 · 고정 파일 ──────────────────────────────────────────────────────────────────────────────────────────────
say ""
say "2) 설치 폴더 · 기동기 · 관문"
for d in "$ROOT" "$ROOT/bin" "$ROOT/lib" "$ROOT/hooks" "$ROOT/app" "$ROOT/bots" "$ROOT/state"; do ensure_dir "$d" 755; done
put_file "$ROOT/bin/slackmod" 755 "$BUNDLE/bin/slackmod"
put_file "$ROOT/lib/slackmod_config.py" 644 "$BUNDLE/lib/slackmod_config.py"
put_file "$ROOT/lib/route_judge.py" 644 "$BUNDLE/lib/route_judge.py"   # «하위 라우터» example judge (harness.json session.jev_route argv)
[ "$HAVE_REC" = 1 ] && put_file "$ROOT/lib/record.py" 644 "$BUNDLE/lib/record.py"   # «slackmod undo» (방금 설치 하나 되돌리기)
put_file "$ROOT/hooks/pass.sh" 755 "$BUNDLE/hooks/pass.sh"
put_file "$ROOT/contract.md" 644 "$WORK/contract.md"   # = templates/main-contract.md (+ the opening line when children_open is set)
put_file "$ROOT/contract-solo.md" 644 "$BUNDLE/templates/main-contract-solo.md"   # «하위 세션 쓰기 = 끔» bots (launch.sh SM_CONTRACT)
put_file "$ROOT/config.example.json" 644 "$BUNDLE/config.example.json"
PASS_SHA="$(sha_file "$BUNDLE/hooks/pass.sh")"

# ── 3. 하네스 · 채널 서버 (폴더 통째 · 지문이 같으면 손 안 댐) ───────────────────────────────────────────────────────
say ""
say "3) 하네스 플러그인 · Slack 다리"
sync_tree() { # sync_tree <src> <dst> [more tree-fp args] — node_modules 는 지문에서 빼고, 바꿀 때도 옮겨 붙여 지킨다
  local src="$1" dst="$2" fs fd
  shift 2
  # __pycache__ = written by python at run time (the gate runner) — not part of what was shipped
  fs="$("${CFG_PY[@]}" tree-fp "$src" --exclude node_modules --exclude __pycache__ "$@")"
  fd="none"
  [ -d "$dst" ] && fd="$("${CFG_PY[@]}" tree-fp "$dst" --exclude node_modules --exclude __pycache__ "$@")"
  if [ "$fs" = "$fd" ]; then act SAME "$dst (폴더 지문 ${fs:0:12})"; return; fi
  act COPY "$dst (폴더 지문 ${fd:0:12} → ${fs:0:12})"
  [ "$DRY" = 1 ] && return
  rm -rf "$dst.slackmod-new"
  cp -R "$src" "$dst.slackmod-new"
  [ -d "$dst/node_modules" ] && mv "$dst/node_modules" "$dst.slackmod-new/node_modules"
  local bk=""
  if [ -d "$dst" ]; then backup_path "$dst" move; bk="$BACKUP/$(rel_home "$dst")"; fi
  mv "$dst.slackmod-new" "$dst"
  rec tree "$dst" "$bk"
}
# K23: Claude Code writes its own type files into a plugin folder it loads (.claude-plugin/types/… · a root tsconfig.json)
# — not shipped, so a re-run after any bot start must not call the folder changed and swap it under the running bot
ENGINE_MADE=(--exclude-path .claude-plugin/types --exclude-path tsconfig.json)
sync_tree "$BUNDLE/app/mods-harness" "$ROOT/app/mods-harness" "${ENGINE_MADE[@]}"
sync_tree "$BUNDLE/app/channel-server" "$ROOT/app/channel-server"
CS="$ROOT/app/channel-server"
# Slack 다리 출처 · 지문 칸 (묶음 제작 때 새긴 값 — 커밋 · 빌드 지문) → 화면에 찍고, 설치본이 그 값과 같은지 확인
SRCF="$BUNDLE/app/channel-server/BRIDGE-SOURCE.txt"
if [ -f "$SRCF" ]; then
  B_COMMIT="$(sed -n 's/^bridge commit: //p' "$SRCF")"
  B_SERVER="$(sed -n 's/^shipped dist\/server.js sha256: //p' "$SRCF")"
  say "  다리 출처 커밋 ${B_COMMIT:0:12} · server.js 지문 ${B_SERVER:0:16} · 다리 주인 대조: $(sed -n 's/^expected by the bridge owner: //p' "$SRCF")"
  if [ "$DRY" = 0 ] && [ -f "$CS/dist/server.js" ] && [ "$(sha_file "$CS/dist/server.js")" != "$B_SERVER" ]; then
    echo "설치된 Slack 다리가 묶음 기록과 다릅니다(server.js 지문) — 묶음을 다시 받으세요" >&2; exit 5
  fi
else
  say "  다리 출처 기록 없음(옛 묶음)"
fi
if [ -n "$NODE_BIN" ] && [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
  WANT="$(sha_file "$BUNDLE/app/channel-server/package-lock.json")-node$NODE_MAJOR"
  HAVE_STAMP="$(cat "$CS/node_modules/.slackmod-stamp" 2>/dev/null || true)"
  if [ "$WANT" = "$HAVE_STAMP" ]; then
    act SAME "Slack 다리 의존성(node_modules)"
  elif [ "$NPM_STEP" = 0 ]; then
    say "  건너뜀   Slack 다리 의존성(--no-npm)"
  else
    act RUN "npm ci --omit=dev (Slack 다리 의존성 · 인터넷 필요)"
    if [ "$DRY" = 0 ]; then
      NPM_BIN="$(dirname "$NODE_BIN")/npm"; [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm)"
      if [ -f "$CS/dist/server.js" ]; then
        ( cd "$CS" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci --omit=dev --no-audit --no-fund >/dev/null )
      else
        ( cd "$CS" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci --no-audit --no-fund >/dev/null && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" run build >/dev/null )
      fi
      printf '%s\n' "$WANT" > "$CS/node_modules/.slackmod-stamp"
    fi
  fi
else
  say "  건너뜀   Slack 다리 의존성(node 20+ 없음)"
fi

# ── 4. 봇마다 설정 · Slack 상태 폴더 ─────────────────────────────────────────────────────────────────────────────────
say ""
say "4) 봇마다 설정"
ALIASES=()
RC_STAGED=""
while IFS=$'\t' read -r kind a b c; do
  case "$kind" in
    BOT) ensure_dir "$ROOT/bots/$a" 755
         ensure_dir "$ROOT/bots/$a/slack" 700
         if [ -d "$b" ]; then act SAME "작업 폴더 $b"; else act DIR "작업 폴더 $b"; [ "$DRY" = 1 ] || mkdir_rec "$b"; fi ;;
    ALIAS) ALIASES+=("$a") ;;
    RC) RC_STAGED="$a" ;;
  esac
done < "$WORK/plan.tsv"
while IFS=$'\t' read -r kind a b c; do
  [ "$kind" = FILE ] && put_file "$a" "$b" "$c"
done < "$WORK/plan.tsv"
# .env: 토큰 줄은 건드리지 않고 채널 · 사용자 ID 같은 비밀 아닌 칸만 맞춘다
for bot in $(awk -F'\t' '$1=="BOT"{print $2}' "$WORK/plan.tsv"); do
  ENVF="$ROOT/bots/$bot/slack/.env"
  SETS=()
  while IFS=$'\t' read -r kind b k v; do
    [ "$kind" = ENV ] && [ "$b" = "$bot" ] && SETS+=(--set "$k=$v")
    [ "$kind" = ENVDROP ] && [ "$b" = "$bot" ] && SETS+=(--drop "$k")
    [ "$kind" = ENVSEC ] && [ "$b" = "$bot" ] && SETS+=(--secrets-from "$k")   # secret-named extra_env: read from a 0600 stage file, not argv
  done < "$WORK/plan.tsv"
  if [ "$DRY" = 1 ]; then
    if [ -f "$ENVF" ]; then r="$("${CFG_PY[@]}" env-upsert --file "$ENVF" --dry-run "${SETS[@]}")"; else r=changed; fi
  else
    r="$("${CFG_PY[@]}" env-upsert --file "$ENVF" "${SETS[@]}")"
  fi
  SECNOTE=""; case " ${SETS[*]} " in *" --secrets-from "*) SECNOTE=" · 비밀 닮은 이름의 값 포함(값은 화면에 안 찍음)" ;; esac
  if [ "$r" = same ]; then act SAME "$ENVF (비밀 아닌 칸$SECNOTE)"; else act WRITE "$ENVF (비밀 아닌 칸 · 토큰 줄 유지 · 0600$SECNOTE)"; fi
done

# ── 5. 켜기 이름(별칭) ───────────────────────────────────────────────────────────────────────────────────────────────
say ""
say "5) 켜기 이름 → $RC_FILE"
# a shell settings file that is a link (a dotfiles folder): the real file behind it is what is backed up, written and recorded —
# undo writes the old bytes back into that real file, so the link stays a link
RC_REAL="$RC_FILE"
if [ -L "$RC_FILE" ] && [ -n "$PY_BIN" ]; then
  RC_REAL="$("$PY_BIN" -I -c 'import os, sys
p = sys.argv[1]; real = os.path.realpath(p); q = p
for _ in range(40):
    if not os.path.islink(q):
        break
    q = os.path.normpath(os.path.join(os.path.dirname(q), os.readlink(q)))
print(q if os.path.realpath(q) == real else real)' "$RC_FILE")" || RC_REAL="$RC_FILE"
  [ -n "$RC_REAL" ] || RC_REAL="$RC_FILE"
fi
ALIAS_ARGS=()
for a in ${ALIASES[@]+"${ALIASES[@]}"}; do ALIAS_ARGS+=(--alias "$a"); done   # bash 3.2: an empty array (blank mode) is not «unbound»
r="$("${CFG_PY[@]}" rc-merge --rc "$RC_FILE" --block "$RC_STAGED" --out "$WORK/rc.new" ${ALIAS_ARGS[@]+"${ALIAS_ARGS[@]}"})"
if [ "$r" = same ]; then act SAME "$RC_FILE (mod-for-slack 칸)"; else
  act WRITE "$RC_FILE (mod-for-slack 칸 · 이름 ${ALIASES[*]:-없음})"
  if [ "$DRY" = 0 ]; then
    if [ -f "$RC_REAL" ]; then
      m0="$(mode_of "$RC_REAL")"; backup_path "$RC_REAL" copy; rec rc "$RC_REAL" "$BACKUP/$(rel_home "$RC_REAL")" "$m0"
    else rec rc "$RC_REAL"; fi
    cat "$WORK/rc.new" > "$RC_REAL"
  fi
fi

# ── 6. 지문 · 끝 ─────────────────────────────────────────────────────────────────────────────────────────────────────
say ""
FP="-"
if [ -d "$ROOT" ]; then
  T1="$("${CFG_PY[@]}" tree-fp "$ROOT" --exclude node_modules --exclude __pycache__ --exclude backup --exclude state --exclude slack --exclude config.json \
        --exclude-path app/mods-harness/.claude-plugin/types --exclude-path app/mods-harness/tsconfig.json)"
  T2="$(sha_file "$RC_STAGED")"
  FP="$(printf '%s %s' "$T1" "$T2" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; } | cut -d' ' -f1)"
  [ "$DRY" = 1 ] || printf '%s\n' "$FP" > "$ROOT/state/install.fp"
fi
# where this kit is and how it was run — «slackmod set-effort» runs the same installer again to remake launch.sh (state/ is
# outside the fingerprint · written only when different, so a second run leaves the folder as it was)
put_state() { # put_state <name> <text>
  [ "$(cat "$ROOT/state/$1" 2>/dev/null || true)" = "$2" ] || printf '%s\n' "$2" > "$ROOT/state/$1"
}
if [ "$DRY" = 0 ] && [ -d "$ROOT/state" ]; then
  put_state bundle-path "$BUNDLE"
  put_state install-args "$(printf -- '--rc\n%s' "$RC_FILE"; [ "$NPM_STEP" = 1 ] || printf '\n--no-npm')"
fi
REC_SAY="$(rec_finish)"; REC_DONE=1   # (the $(…) runs in a subshell — mark it done here so the EXIT trap does not run it twice)
say "결과: 바뀜 $CHANGED · 그대로 $SAME · 지문 ${FP:0:16}$( [ "$DRY" = 1 ] && echo ' (미리 보기 — 아무것도 안 씀)')"
[ "$DRY" = 1 ] || [ "$CHANGED" -eq 0 ] || say "백업: $BACKUP (바뀐 것이 있을 때만 생김)"
case "$REC_SAY" in
  되돌리기\ 기록:*) say "되돌리기: slackmod undo (방금 설치 하나만 · 봇 slack/.env 의 토큰은 그대로) · ${REC_SAY}" ;;
  *주의*) say "$REC_SAY" ;;   # the record could not be finished — say so (undo would otherwise say «되돌릴 설치가 없습니다» later)
esac
if [ "$DRY" = 0 ]; then
  say ""
  say "다음:"
  say "  1) source $RC_FILE"
  for bot in $(awk -F'\t' '$1=="BOT"{print $2}' "$WORK/plan.tsv"); do say "  2) slackmod set-token $bot      ← Slack 앱 토큰 2개(화면에 안 보임)"; done
  [ "$WSL" = 1 ] && say "  3) slackmod check-windows     ← Windows 쪽에서 같은 Slack 앱이 켜져 있으면 메시지가 갈립니다(먼저 끄기)"
  if [ -n "${ALIASES[*]:-}" ]; then say "  4) 봇 하나씩: ${ALIASES[*]}  · 상태: slackmod status"
  else say "  (봇 0 — 빈 판으로 설치했습니다. 봇을 더하려면 설치 마법사를 다시 부르세요)"; fi
fi
exit 0
