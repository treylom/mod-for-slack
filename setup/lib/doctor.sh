#!/usr/bin/env bash
# doctor.sh — 상태 점검 (읽기만 · 쓰기·끄기·고치기 0 · 토큰 값 출력 0)
#   bash doctor.sh              칸마다 한 줄 + «할 일 ·» 한 줄 + 맨 끝 «요약: OK n · 주의 n · 실패 n · 건너뜀 n» · 끝 코드 언제나 0
#   bash doctor.sh --strict     끝 코드 0 = 주의·실패 없음(건너뜀은 있어도 됨) · 1 = 주의/실패 있음 · 2 = 점검 못 함(python3 없음 · 설치 안 보임)
#   bash doctor.sh --root=DIR   설치 자리(기본 $SLACKMOD_ROOT 또는 ~/.slackmod)
# 칸 줄 꼴: «OK|주의|실패|건너뜀 · [번호] 무엇 · 고칠 1줄» — 색·커서 제어 문자 없음(결과 파일에 그대로 붙음). 요약의 네 수를 더하면 언제나 칸 수(13).
# 칸: [1]창 도구 [2]Claude 로그인 [3]Slack 토큰 [4]성격 점검 [5]Slack 왕복 [6]봇 초대 실패 3갈래 [7]밖 Slack 다리 [8]옛 ThisCode 훅·봇에 켜진 다른 채널 플러그인
#     [9]봇 켜짐·창·연결 [10]Windows 쪽 [11]예약 목록 [12]채널 기능(④ 채널 기능 꺼짐) [13]관문 파일 확인 값(고정 지문). 건너뜀 = 해당 없음이거나 앞 칸이 막아 볼 수 없음(이유가 줄에 적힘).
# 시험용 환경 변수(없으면 진짜로 본다):
#   SLACKMOD_DOCTOR_FAKE_SLACK=DIR   Slack 대신 DIR/<봇>/<방법>.json 또는 DIR/<방법>.json 을 읽음(auth.test · conversations.history)
#   SLACKMOD_DOCTOR_SLACK_API=URL    Slack API 주소 바꾸기(기본 https://slack.com/api)
#   SLACKMOD_DOCTOR_PS_FILE=FILE     ps 출력 대신 이 파일(uid pid ppid args 꼴)
#   SLACKMOD_PERSONA_CHECK=FILE      persona-check.py 자리(기본 이 파일 옆)
#   SLACKMOD_DOCTOR_MANAGED_DIR=DIR  조직 관리 설정 폴더 바꾸기(DIR/managed-settings.json · DIR/managed-settings.d/*.json · 기본 = 맥·리눅스 표준 자리 둘)
# bash 3.2(맥 기본) · 리눅스 · WSL 에서 돈다. 이 스크립트는 파일을 쓰지 않는다(임시 파일도 없음). Slack 은 읽기 호출만(auth.test · conversations.history).
set -u

STRICT=0
# HOME can be unset (cron · env -i): take the account home from the system, never die on it
if [ -z "${HOME:-}" ]; then
  HOME="$( (cd ~ 2>/dev/null && pwd) || true)"
  [ -n "$HOME" ] && [ "$HOME" != "~" ] || HOME="/"
  export HOME
fi
ROOT="${SLACKMOD_ROOT:-$HOME/.slackmod}"
for a in "$@"; do
  case "$a" in
    --strict) STRICT=1 ;;
    --root=*) ROOT="${a#--root=}" ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "doctor: 모르는 옵션 무시: $a" >&2 ;;
  esac
done

N_OK=0; N_WARN=0; N_FAIL=0; N_SKIP=0; CANT=0
OUT=""
PY="$(command -v python3 2>/dev/null || true)"
SM="$ROOT/bin/slackmod"
CFGPY="$ROOT/lib/slackmod_config.py"
ME_UID="$(id -u 2>/dev/null || echo -1)"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)"
PERSONA_CHECK="${SLACKMOD_PERSONA_CHECK:-$SELF_DIR/persona-check.py}"

# one part of a line: no newline · tab · CR · control characters (ESC included)
clean() { printf '%s' "$1" | tr '\n\r\t' '   ' | LC_ALL=C tr -d '\000-\010\013-\037\177'; }
emit() { OUT="$OUT$(clean "$1")
"; }
cell() { # cell <OK|주의|실패|건너뜀> <무엇> <고칠 1줄>
  case "$1" in OK) N_OK=$((N_OK + 1)) ;; 주의) N_WARN=$((N_WARN + 1)) ;; 건너뜀) N_SKIP=$((N_SKIP + 1)) ;; *) N_FAIL=$((N_FAIL + 1)) ;; esac
  emit "$1 · $2 · $3"
}
# to <seconds> cmd… — run with a time limit (timeout · perl alarm · or plain when neither exists)
to() {
  local t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$t" "$@"
  elif command -v perl >/dev/null 2>&1; then perl -e 'alarm shift @ARGV; exec @ARGV or exit 127' "$t" "$@"
  else "$@"; fi
}
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }
installed() { [ -f "$SM" ] && [ -f "$ROOT/bots.list" ]; }
bots() { installed && grep -E '^[a-z][a-z0-9-]{1,30}$' "$ROOT/bots.list" 2>/dev/null; }
# bots.list has lines but none in the shape slackmod reads (CR line ends · spaces) → slackmod itself would miss them
bots_list_broken() { installed && [ -z "$(bots)" ] && grep -q '[^[:space:]]' "$ROOT/bots.list" 2>/dev/null; }
# launch.sh is READ as text here, never run (slackmod runs it at start; this check is read-only — a launch.sh swapped for a
# symlink or edited in place must not get its commands run by a check). Only «KEY=value» / «export KEY=value» lines are used;
# the value is unquoted the way the generator writes it (shlex.quote), the last such line wins (as sourcing would), a line that
# is anything else — a command chained after the value, a $( ) or backticks in an unquoted word — is skipped, not run.
PY_LAUNCH='
import re, shlex, sys
f, key = sys.argv[1], sys.argv[2]
try:
    with open(f, encoding="utf-8", errors="replace") as fh: text = fh.read(262144)
except Exception:
    sys.exit(1)
pat = re.compile(r"(?:export[ \t]+)?" + re.escape(key) + r"=(.*)$")
val = ""
for ln in text.splitlines():
    m = pat.match(ln)
    if not m: continue
    try: t = shlex.split(m.group(1))
    except ValueError: continue
    if len(t) <= 1: val = t[0] if t else ""
sys.stdout.write(val)
'
launch_var() { # launch_var <bot> <SM_NAME> — a value from the generated launch.sh (the file slackmod sources) · read, not run
  local f="$ROOT/bots/$1/launch.sh"
  [ -f "$f" ] || return 1
  case "$2" in SM_WORK_DIR|SM_CLAUDE|SM_EXTRA_CHANNELS) ;; *) return 1 ;; esac
  [ -n "$PY" ] || return 1
  "$PY" -I -B -c "$PY_LAUNCH" "$f" "$2" 2>/dev/null
}

# setup.json (the wizard's one result file): «slack=on|off» then «<bot>TAB<persona_dir>TAB<source>» per bot. Missing or broken = no information.
PY_SETUP='
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f: d = json.load(f)
except Exception: sys.exit(0)
if not isinstance(d, dict): sys.exit(0)
s = d.get("slack")
print("slack=" + ("off" if isinstance(s, dict) and s.get("enabled") is False else "on"))
for b in (d.get("bots") if isinstance(d.get("bots"), list) else []):
    if isinstance(b, dict) and isinstance(b.get("name"), str):
        pd = b.get("persona_dir") if isinstance(b.get("persona_dir"), str) else ""
        src = b.get("source") if isinstance(b.get("source"), str) else ""
        print("%s\t%s\t%s" % (b["name"], pd.replace("\t", " "), src.replace("\t", " ")))
'
SETUP_INFO=""
[ -n "$PY" ] && [ -f "$ROOT/setup.json" ] && SETUP_INFO="$("$PY" -I -B -c "$PY_SETUP" "$ROOT/setup.json" 2>/dev/null)"
SLACK_OFF=0
case "$SETUP_INFO" in slack=off*) SLACK_OFF=1 ;; esac
setup_field() { # setup_field <bot> <2|3> → persona_dir or source of that bot from setup.json
  printf '%s\n' "$SETUP_INFO" | awk -F'\t' -v b="$1" -v c="$2" '$1 == b { print $c; exit }'
}

PS_OUT=""
if [ -n "${SLACKMOD_DOCTOR_PS_FILE:-}" ]; then PS_OUT="$(cat "$SLACKMOD_DOCTOR_PS_FILE" 2>/dev/null)"
else PS_OUT="$(ps -ww -eo uid=,pid=,ppid=,args= 2>/dev/null)"; fi

OSNAME="$(uname -s 2>/dev/null || echo ?)"
WHERE="$OSNAME"; is_wsl && WHERE="Linux(WSL)"
emit "상태 점검 · $(date '+%Y-%m-%d %H:%M') · $WHERE · 읽기만(쓰기·끄기·고치기 0)"

# ── [1] 창 도구 ──────────────────────────────────────────────────────────────────────────────────────────────────────
# 정식 = tmux(cmux 는 그 창 안에서 tmux · herdr 는 그 안 tmux 또는 slackmod start --backend herdr). Orca = 시험 중 · 따로 설정.
check_window_tool() {
  local have="" t orca=0 ver=""
  for t in tmux cmux herdr; do command -v "$t" >/dev/null 2>&1 && have="${have:+$have, }$t"; done
  [ -n "${ORCA_TERMINAL_HANDLE:-}" ] && orca=1
  case "${TMUX:-}" in *orca-claude-agent-teams*) orca=1 ;; esac
  command -v tmux >/dev/null 2>&1 && ver="$(tmux -V 2>/dev/null | head -n 1 | cut -c1-30)"
  if [ "$orca" = 1 ]; then
    cell 주의 "[1] Orca 터미널 안에서 돌고 있음(Orca 는 시험 중 · 따로 설정) — Orca 의 가짜 tmux 는 새 창 만들기를 못 해 하위 세션이 안 열림(보이는 도구: ${have:-없음})" \
      "Orca 밖의 일반 터미널에서 tmux 를 열어 켜기 · Orca 에서 쓰려면 지원 표(SUPPORT.md)의 Orca 칸 안내대로 따로 설정"
  elif command -v tmux >/dev/null 2>&1; then
    cell OK "[1] 창 도구 있음: ${ver:-tmux}(정식)${have:+ · 보이는 도구: $have}" "할 것 없음(cmux 쓰면 cmux 창 안에서 tmux 로 켜기)"
  elif command -v herdr >/dev/null 2>&1; then
    cell 주의 "[1] tmux 가 없고 herdr 만 보임 — herdr 탭에서는 켤 수 있지만(slackmod start 봇이름 --backend herdr) 기본 길은 tmux" \
      "tmux 설치 권장(맥: brew install tmux · 우분투: sudo apt-get install -y tmux)"
  else
    cell 실패 "[1] tmux 가 없음 — 봇을 켤 수 없음${have:+(보이는 도구: $have · cmux 도 그 안에서 tmux 가 필요)}" \
      "맥: brew install tmux · 우분투·WSL: sudo apt-get install -y tmux (관리자 한 줄)"
  fi
}

# ── [2] Claude 로그인 ────────────────────────────────────────────────────────────────────────────────────────────────
# claude auth status --json: authMethod «claude.ai» 일 때만 subscriptionType 이 들어온다. 값은 고른 4칸만 뽑는다
# (그 JSON 에는 메일 주소 · 조직 이름도 있어 그대로 찍지 않는다).
PY_AUTH='
import json, re, sys
try: d = json.loads(sys.stdin.read())
except Exception: print("unreadable - - -"); sys.exit(0)
def w(v, pat):
    return v if isinstance(v, str) and re.fullmatch(pat, v) else ("-" if v is None else "?")
print("yes" if d.get("loggedIn") is True else "no", w(d.get("authMethod"), r"[a-z._-]{1,20}"),
      w(d.get("subscriptionType"), r"[a-z_]{1,20}"), "key" if d.get("apiKeySource") else "-")
'
check_login() {
  local cl="" b raw res li am st ks envkey=0
  # sec r2 ⑬ (re-review 10-26): the doctor runs no program named in launch.sh (SM_CLAUDE) — only the claude on PATH or the
  # installer's ~/.local/bin/claude, the same one the person would run for /login.
  cl="$(command -v claude 2>/dev/null || true)"
  [ -n "$cl" ] || { [ -x "$HOME/.local/bin/claude" ] && cl="$HOME/.local/bin/claude"; }
  if [ -z "$cl" ]; then cell 실패 "[2] Claude Code 가 없음" "curl -fsSL https://claude.ai/install.sh | bash 뒤 claude 한 번 열어 /login"; return; fi
  if [ -z "$PY" ]; then cell 주의 "[2] Claude 로그인: python3 가 없어 못 읽음" "사람이 claude 안에서 /status 한 번"; return; fi
  [ -n "${ANTHROPIC_API_KEY:-}" ] && envkey=1
  if command -v tmux >/dev/null 2>&1 && tmux show-environment -g 2>/dev/null | LC_ALL=C grep -q '^ANTHROPIC_API_KEY='; then envkey=1; fi
  raw="$(DISABLE_AUTOUPDATER=1 to 25 "$cl" auth status --json 2>/dev/null)"
  res="$(printf '%s' "$raw" | "$PY" -I -B -c "$PY_AUTH" 2>/dev/null)"
  raw=""
  set -- $res
  li="${1:-unreadable}"; am="${2:-?}"; st="${3:-?}"; ks="${4:--}"
  if [ "$li" = unreadable ]; then cell 주의 "[2] Claude 로그인 상태를 읽지 못함" "사람이 claude 안에서 /status 한 번(로그인 · 요금제 확인)"
  elif [ "$li" = no ]; then cell 실패 "[2] Claude 로그인 없음 — 봇이 생각을 못 함" "터미널에서 claude 실행 → /login 1회(안내대로 계정으로 로그인)"
  elif [ "$ks" = key ] || [ "$am" = api_key ] || [ "$envkey" = 1 ]; then
    cell 주의 "[2] Claude 로그인 있음, 그런데 API 키가 걸려 있음(쓴 만큼 과금 · 정액제 로그인이 아닐 수 있음)" "정액제로 쓰려면 ANTHROPIC_API_KEY 를 지우고 claude 안 /login(사람이 고르기)"
  elif [ "$am" = claude.ai ]; then
    case "$st" in
      pro|max|team|enterprise) cell OK "[2] Claude 로그인 있음(claude.ai 계정 · 정액제 $st)" "할 것 없음" ;;
      *) cell 주의 "[2] Claude 로그인 있음(claude.ai 계정), 정액제인지 확인 못 함" "사람이 claude 안에서 /status 한 번" ;;
    esac
  else
    cell 주의 "[2] Claude 로그인 있음(방식 $am), 정액제인지 확인 못 함" "사람이 claude 안에서 /status 한 번"
  fi
}

# ── 설치·봇 목록 공통 판정 ───────────────────────────────────────────────────────────────────────────────────────────
# why_no_bots <칸 번호> → 0 이면 이 칸은 건너뜀(줄을 이미 냈음) · 1 이면 봇이 있어 계속
BOT_LIST=""
why_skip() { # why_skip <번호> <칸 이름> [slack] — prints the 건너뜀/실패 cell and returns 0 when the cell cannot be judged
  local n="$1" what="$2" needslack="${3:-}"
  if ! installed; then CANT=1; cell 건너뜀 "[$n] $what: 설치가 안 보여 못 봄($ROOT 에 bin/slackmod · bots.list 없음)" "설치부터(install.sh) 한 뒤 다시 점검"; return 0; fi
  if [ -z "$BOT_LIST" ]; then
    if bots_list_broken; then
      # one cause, one failure: only the token cell (3) fails; the others point to it
      if [ "$n" = 3 ]; then cell 실패 "[$n] $what: 봇 목록(bots.list) 꼴이 깨짐(줄 끝 CR · 빈칸 등 — slackmod 도 봇을 못 찾음)" "install.sh 다시(목록을 새로 씀)"
      else cell 건너뜀 "[$n] $what: 봇 목록(bots.list) 꼴이 깨져 봇을 못 찾음([3] 칸 참고)" "[3] 칸의 install.sh 다시부터"; fi
    else cell 건너뜀 "[$n] $what: 봇이 0개(빈 판 — 설치만 한 상태)" "봇을 만들려면 마법사의 봇 칸 다시(/mods-setup:setup --section bots)"; fi
    return 0
  fi
  if [ "$needslack" = slack ] && [ "$SLACK_OFF" = 1 ]; then cell 건너뜀 "[$n] $what: Slack 연결을 건너뛰기로 골랐음" "Slack 을 쓰려면 마법사의 Slack 칸 다시(/mods-setup:setup --section slack)"; return 0; fi
  return 1
}

# ── [3] 봇별 Slack 토큰 ──────────────────────────────────────────────────────────────────────────────────────────────
env_status() { "$PY" -I -B "$CFGPY" env-status --file "$ROOT/bots/$1/slack/.env" 2>/dev/null; }
check_tokens() {
  local b st bt at list="" miss="" fixb="" ids="" id dup="" n=0
  why_skip 3 "Slack 토큰" slack && return
  if [ -z "$PY" ] || [ ! -f "$CFGPY" ]; then cell 주의 "[3] Slack 토큰: python3 나 slackmod_config.py 가 없어 못 읽음" "설치를 다시(install.sh) 하거나 python3 설치"; return; fi
  for b in $BOT_LIST; do
    n=$((n + 1))
    st="$(env_status "$b")"
    bt="${st#bot_token=}"; bt="${bt%% *}"; at="${st##*app_token=}"
    case "$bt" in set|missing) ;; *) bt="?" ;; esac
    case "$at" in set|missing) ;; *) at="?" ;; esac
    list="${list:+$list, }$b ${bt}·${at}"
    case "${bt}·${at}" in set·set) ;; *) miss="${miss:+$miss, }$b"; fixb="${fixb:+$fixb ; }slackmod set-token $b" ;; esac
    id="$("$PY" -I -B "$CFGPY" app-id --file "$ROOT/bots/$b/slack/.env" 2>/dev/null)"
    if [ -n "$id" ] && [ "$id" != - ]; then
      case " $ids " in *" $id:"*) dup="${dup:+$dup, }$b" ;; esac
      ids="$ids $id:$b"
    fi
  done
  if [ -n "$miss" ]; then cell 실패 "[3] Slack 토큰 빠짐($list)" "$fixb (붙여 넣어도 화면에 안 보임 · 채팅에 붙이지 않기)"
  elif [ -n "$dup" ]; then cell 실패 "[3] 두 봇이 같은 Slack 앱 토큰을 씀($dup 이 앞 봇과 같음) — 메시지가 갈림" "봇마다 Slack 앱을 따로 만들어 slackmod set-token 봇이름 다시"
  else cell OK "[3] 봇별 Slack 토큰 2개 다 있음($list)" "할 것 없음"; fi
}

# ── [4] 성격 점검 (봇마다 persona-check) ─────────────────────────────────────────────────────────────────────────────
check_persona() {
  local b dir src skip res rc n cells parts="" worst=OK fix="" one first cnt any=0
  why_skip 4 "성격 점검" && return
  if [ -z "$PY" ] || [ ! -f "$PERSONA_CHECK" ]; then cell 건너뜀 "[4] 성격 점검: persona-check.py 가 안 보임($PERSONA_CHECK)" "설치 묶음의 setup/lib/persona-check.py 자리 확인"; return; fi
  for b in $BOT_LIST; do
    dir="$(setup_field "$b" 2)"; [ -n "$dir" ] || dir="$(launch_var "$b" SM_WORK_DIR)"
    if [ -z "$dir" ] || [ ! -d "$dir" ]; then
      parts="${parts:+$parts; }$b 성격 폴더가 없음"; [ "$worst" = OK ] && worst=주의; any=1
      [ -n "$fix" ] || fix="봇 폴더를 만들고 bot-interview 로 이름 · 성격 만들기"
      continue
    fi
    src="$(setup_field "$b" 3)"; skip=""; [ "$src" = import ] && skip="required"
    if [ -n "$skip" ]; then res="$("$PY" -I -B "$PERSONA_CHECK" --skip "$skip" "$dir" 2>/dev/null)"; rc=$?
    else res="$("$PY" -I -B "$PERSONA_CHECK" "$dir" 2>/dev/null)"; rc=$?; fi
    case "$rc" in
      0) parts="${parts:+$parts; }$b 통과" ;;
      1)
        any=1
        n="$(printf '%s\n' "$res" | grep -c '^걸림 · ')"
        cells="$(printf '%s\n' "$res" | grep '^걸림 · ' | sed -E 's/^걸림 · ([^ ]+) · .*/\1/' | sort -u | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
        parts="${parts:+$parts; }$b 걸림 ${n}(${cells})"
        if printf '%s\n' "$res" | grep -q '^걸림 · 비밀값 · '; then worst=실패; else [ "$worst" = OK ] && worst=주의; fi
        first="$(printf '%s\n' "$res" | grep -m1 '^걸림 · ' | sed 's/.* · //')"
        [ -n "$fix" ] || fix="$b: $first"
        ;;
      *) parts="${parts:+$parts; }$b 점검을 못 함"; [ "$worst" = OK ] && worst=주의; any=1; [ -n "$fix" ] || fix="persona-check.py 를 직접 돌려 오류 보기: python3 persona-check.py 봇폴더" ;;
    esac
  done
  if [ "$any" = 0 ]; then cell OK "[4] 성격 점검: $parts" "할 것 없음"
  else cell "$worst" "[4] 성격 점검: $parts" "${fix:-할 것 없음}"; fi
}

# ── [5] Slack 왕복 · [6] 봇 초대 실패 3갈래 ──────────────────────────────────────────────────────────────────────────
# 봇마다 한 번: auth.test(토큰이 살아 있나) → conversations.history(channel, limit=1)(그 채널이 보이나 · 봇이 들어 있나).
# 표준 매니페스트 권한(channels:history 등)만으로 되는 호출만 쓴다 — conversations.info 는 channels:read 가 따로 있어야 해서 안 씀.
# 토큰은 이 프로그램 안에서만 읽고 어디에도 안 찍는다(글 내용도 안 씀). 출력은 봇 이름 + 고정 낱말 하나.
#   PENDING 봇 토큰(xoxb) 없음·빈칸·자리표시자 · AUTH_ERR:코드 · NET 닿지 못함 · NO_CHANNEL 채널 ID 없음
#   CH_NOT_FOUND:팀ID 채널이 안 보임(다른 워크스페이스이거나 비공개·미초대) · NOT_IN_CHANNEL 봇이 채널에 없음
#   POLICY:코드 조직 정책이 막음 · HIST_ERR:코드 · NET_HIST · OK
# 갈래 ② =봇 토큰 없음 + auth.test 의 invalid_auth · token_revoked · account_inactive.
PY_SLACK='
import json, os, re, sys, urllib.parse, urllib.request
fake = os.environ.get("SLACKMOD_DOCTOR_FAKE_SLACK", "")
base = os.environ.get("SLACKMOD_DOCTOR_SLACK_API", "https://slack.com/api").rstrip("/")
def envval(path, key):
    try:
        for ln in open(path, encoding="utf-8").read().split("\n"):
            m = re.match(r"^\s*" + key + r"=(.*)$", ln)
            if m: return m.group(1).strip().strip("\"").strip("\x27")
    except OSError: pass
    return ""
def tok_ok(v, prefix): return v.startswith(prefix) and len(v) > len(prefix) + 10 and "REPLACE" not in v
def code(v): return v if isinstance(v, str) and re.fullmatch(r"[a-z_]{1,40}", v) else "unknown"
def call(method, bot, token, params):
    if fake:
        for p in (os.path.join(fake, bot, method + ".json"), os.path.join(fake, method + ".json")):
            if os.path.isfile(p):
                try:
                    with open(p, encoding="utf-8") as f: return json.load(f)
                except Exception: return {"ok": False, "error": "unreadable_answer"}
        return None
    url = base + "/" + method + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return json.loads(r.read().decode("utf-8", "replace"))
    except Exception: return None
def prim(raw):  # the primary channel id of SLACK_CHANNEL_ID, or "" when there is none / a placeholder
    ids = [x.strip() for x in (raw or "").split(",") if x.strip()]
    p = ids[0] if ids else ""
    return p if re.fullmatch(r"[CG][A-Z0-9]{6,20}", p) and "XXXX" not in p else ""
args = sys.argv[1:]
for i in range(0, len(args) - 1, 2):
    bot, env = args[i], args[i + 1]
    bt, at, ch = envval(env, "SLACK_BOT_TOKEN"), envval(env, "SLACK_APP_TOKEN"), envval(env, "SLACK_CHANNEL_ID")
    if not tok_ok(bt, "xoxb-"): st = "PENDING"
    else:
        a = call("auth.test", bot, bt, None)
        if a is None: st = "NET"
        elif not a.get("ok"): st = "AUTH_ERR:" + code(a.get("error"))
        # K22: the bridge reads a comma list (blanks dropped · first = primary · «*» never first) — check the primary
        elif not prim(ch): st = "NO_CHANNEL"
        else:
            team = a.get("team_id") if isinstance(a.get("team_id"), str) and re.fullmatch(r"[A-Z0-9]{3,20}", a.get("team_id")) else "-"
            h = call("conversations.history", bot, bt, {"channel": prim(ch), "limit": "1"})
            if h is None: st = "NET_HIST"
            elif not h.get("ok"):
                e = code(h.get("error"))
                if e == "channel_not_found": st = "CH_NOT_FOUND:" + team
                elif e == "not_in_channel": st = "NOT_IN_CHANNEL"
                elif e in ("ekm_access_denied", "restricted_action"): st = "POLICY:" + e
                else: st = "HIST_ERR:" + e
            else: st = "OK"
    print(bot + "\t" + st)
'
SLACK_RES=""
slack_probe() { # fills SLACK_RES once: "<bot>TAB<state>" lines
  local b args=""
  [ -n "$PY" ] || return 0
  set --
  for b in $BOT_LIST; do set -- "$@" "$b" "$ROOT/bots/$b/slack/.env"; done
  SLACK_RES="$(to 60 "$PY" -I -B -c "$PY_SLACK" "$@" 2>/dev/null)"
}
slack_state() { printf '%s\n' "$SLACK_RES" | awk -F'\t' -v b="$1" '$1 == b { print $2; exit }'; }

check_slack_roundtrip() {
  local b st ok="" okn=0 bad="" fix="" worst=OK skipped="" code
  why_skip 5 "Slack 왕복" slack && return
  if [ -z "$PY" ]; then cell 주의 "[5] Slack 왕복: python3 가 없어 못 함" "python3 설치 뒤 다시 점검"; return; fi
  for b in $BOT_LIST; do
    st="$(slack_state "$b")"
    case "$st" in
      PENDING|'') skipped="${skipped:+$skipped, }$b" ;;
      NET) bad="${bad:+$bad; }$b Slack 에 닿지 못함(네트워크 · 방화벽 · 프록시)"; [ "$worst" = OK ] && worst=주의; fix="${fix:+$fix ; }인터넷 연결을 확인하고 다시 점검(회사망이면 slack.com 허용)" ;;
      AUTH_ERR:*)
        code="${st#AUTH_ERR:}"
        case "$code" in
          invalid_auth|not_authed|account_inactive|token_revoked|token_expired)
            bad="${bad:+$bad; }$b auth.test 가 «${code}» — 토큰이 틀리거나 막힘"; worst=실패
            fix="${fix:+$fix ; }slackmod set-token $b 뒤 slackmod stop $b ; slackmod start $b" ;;
          *) bad="${bad:+$bad; }$b auth.test 가 «${code}» 라고 답함"; worst=실패; fix="${fix:+$fix ; }Slack 앱 설정의 Install App 쪽 상태를 확인" ;;
        esac ;;
      *) okn=$((okn + 1)); ok="${ok:+$ok, }$b" ;;
    esac
  done
  if [ -n "$bad" ]; then cell "$worst" "[5] Slack 왕복: $bad${ok:+ · 통과: $ok}" "$fix"
  elif [ "$okn" -eq 0 ]; then cell 건너뜀 "[5] Slack 왕복: 봇 토큰이 없어 못 해 봄($skipped) — 토큰 칸 · 초대 칸 참고" "토큰부터 넣기(slackmod set-token 봇이름)"
  else cell OK "[5] Slack 왕복: auth.test 통과(토큰 살아 있음: $ok)${skipped:+ · 토큰이 없어 못 해 본 봇: $skipped}" "할 것 없음"; fi
}

check_invite() {
  local b st parts="" fix="" worst=OK n=0 okn=0 one lvl team
  why_skip 6 "봇 초대 실패 3갈래" slack && return
  if [ -z "$PY" ]; then cell 주의 "[6] 봇 초대: python3 가 없어 못 함" "python3 설치 뒤 다시 점검"; return; fi
  for b in $BOT_LIST; do
    st="$(slack_state "$b")"; one=""; lvl=""
    case "$st" in
      PENDING)
        one="$b ② 관리자 승인 대기 꼴 — 봇 토큰이 없음: 앱이 워크스페이스에 아직 설치되지 않았거나 승인 대기입니다"; lvl=실패
        fix="${fix:+$fix ; }$b: 관리자에게 앱 승인 요청 · 승인 뒤 OAuth 화면의 Bot Token 을 slackmod set-token $b 으로 넣기" ;;
      AUTH_ERR:invalid_auth|AUTH_ERR:token_revoked|AUTH_ERR:account_inactive)
        one="$b ② 관리자 승인 대기 꼴 — auth.test 가 «${st#AUTH_ERR:}»: 앱이 워크스페이스에 아직 설치되지 않았거나 승인 대기입니다(설치 취소 · 승인 철회 포함)"; lvl=실패
        fix="${fix:+$fix ; }$b: 관리자에게 앱 승인 요청 · 승인 뒤 OAuth 화면의 Bot Token 을 slackmod set-token $b 으로 넣기 — 토큰을 다시 받으세요" ;;
      CH_NOT_FOUND:*)
        team="${st#CH_NOT_FOUND:}"; [ "$team" = - ] && team="" || team="($team)"
        one="$b ① 다른 워크스페이스(또는 비공개·미초대) — 이 채널 ID 는 봇의 워크스페이스${team}에서 안 보입니다(channel_not_found)"; lvl=실패
        fix="${fix:+$fix ; }$b: 앱을 그 워크스페이스에 설치했는지 · 채널 링크의 워크스페이스가 같은지 확인 · 비공개 채널이면 먼저 초대" ;;
      NOT_IN_CHANNEL)
        one="$b ③ 손님 계정·채널 제한 — 봇이 채널에 없습니다(not_in_channel)"; lvl=실패
        fix="${fix:+$fix ; }$b: 채널에서 /invite @봇 · 손님 계정(멀티/싱글 채널 게스트)은 앱을 초대할 수 없으니 정회원이 초대" ;;
      POLICY:*)
        one="$b ③ 조직 정책 제한 — 워크스페이스 정책이 앱의 이 채널 접근을 막습니다(${st#POLICY:})"; lvl=실패
        fix="${fix:+$fix ; }$b: 워크스페이스 관리자에게 문의" ;;
      HIST_ERR:missing_scope)
        one="$b 매니페스트 권한 부족 — 앱 권한에 channels:history 가 없습니다(missing_scope)"; lvl=주의
        fix="${fix:+$fix ; }$b: 매니페스트 갱신(비공개 채널이면 groups:history 도) 뒤 재설치 → slackmod set-token $b" ;;
      HIST_ERR:is_archived) one="$b 그 채널이 보관 처리됨(is_archived)"; lvl=주의; fix="${fix:+$fix ; }$b: 보관을 풀거나 다른 채널 ID 로 바꾸기" ;;
      HIST_ERR:*) one="$b 채널 글 읽기가 «${st#HIST_ERR:}» 라고 답함"; lvl=주의; fix="${fix:+$fix ; }$b: 앱 권한(scopes)과 채널 ID 를 확인" ;;
      NO_CHANNEL) one="$b 설정에 채널 ID 가 없거나 자리표시자"; lvl=주의; fix="${fix:+$fix ; }마법사의 Slack 칸 다시(채널 ID 채우기)" ;;
      NET_HIST) one="$b 채널 글 읽기가 Slack 에 닿지 못함"; lvl=주의; fix="${fix:+$fix ; }인터넷 연결을 확인하고 다시 점검" ;;
      OK) okn=$((okn + 1)); one="$b 정상(채널이 보이고 봇이 들어 있음)" ;;
      *) continue ;;   # other auth errors · NET · '' : [5] 가 이미 말함
    esac
    n=$((n + 1))
    parts="${parts:+$parts; }$one"
    case "$lvl" in 실패) worst=실패 ;; 주의) [ "$worst" = OK ] && worst=주의 ;; esac
  done
  if [ "$n" -eq 0 ]; then cell 건너뜀 "[6] 봇 초대 실패 3갈래: Slack 에 닿지 못하거나 auth.test 가 풀 수 없는 답을 줘서 채널을 못 봄([5] 칸 참고)" "[5] 칸부터 고치기"
  elif [ "$worst" = OK ]; then cell OK "[6] 봇 초대 3갈래(① 다른 워크스페이스 · ② 관리자 승인 대기 · ③ 손님 계정·채널 제한) 모두 해당 없음: $parts" "할 것 없음"
  else cell "$worst" "[6] 봇 초대 실패: $parts" "${fix:-할 것 없음}"; fi
}

# ── [7] SlackMod 밖 Slack 다리 ───────────────────────────────────────────────────────────────────────────────────────
# 예전 방식 다리 = «cd …/claude-channel-server && npm start» 감싸개 쉘 → npm → «node dist/server.js»(상대 경로).
# 한 다리를 한 번만 센다: 한 줄기(감싸개 → npm → node) 안에서 가장 아래 다리 줄 하나만 센다(그 주인 = 진짜 프로세스 주인).
PY_BRIDGES='
import os, re, subprocess, sys
root, me = sys.argv[1], sys.argv[2]
roots = {root.rstrip("/") + "/app/"}
try: roots.add(os.path.realpath(root).rstrip("/") + "/app/")
except Exception: pass
procs = {}
for ln in sys.stdin.read().splitlines():
    p = ln.split(None, 3)
    if len(p) < 4 or not p[1].isdigit(): continue
    procs[p[1]] = (p[0], p[2], p[3])
def cwd_of(pid):
    try: return os.readlink("/proc/%s/cwd" % pid)
    except Exception: pass
    try:
        r = subprocess.run(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"], capture_output=True, text=True, timeout=5)
        for x in r.stdout.splitlines():
            if x.startswith("n"): return x[1:]
    except Exception: pass
    return ""
def ours(path):
    return any(path.rstrip("/") + "/" == r + "channel-server/" or path.startswith(r) for r in roots)
REL = re.compile(r"(^|\s)(\./)?dist/(server|mcp)\.js(\s|$)")
NODE = re.compile(r"(^|/)(node|nodejs)$")
# sec ⑪ round 3 (security review 10-26): EXACT shapes only, both two words — same rule as slackmod relay_line / ours_line (the start gate)
def relay(args):
    t = args.split()
    return len(t) == 2 and NODE.search(t[0]) is not None and (t[1].endswith("/dist/mcp.js") or t[1] == "dist/mcp.js")
def ours_line(args):
    t = args.split()
    return len(t) == 2 and NODE.search(t[0]) is not None and any(t[1] in (r + "channel-server/dist/server.js", r + "channel-server/dist/mcp.js") for r in roots)
kind = {}
for pid, (uid, ppid, args) in procs.items():
    # paths in the command line that name the bridge package · ours = every such path sits under the install folder app/
    paths = [t.strip("\"\x27;&|()") for t in args.split() if "channel-server" in t]
    if paths:
        if ours_line(args): continue
        kind[pid] = "relay" if relay(args) else "bridge"
        continue
    m = REL.search(args)
    if m:  # «node dist/server.js» = relative: the working folder tells whose
        c = cwd_of(pid)
        if "channel-server" in c and not ours(c):
            kind[pid] = "relay" if relay(args) else "bridge"
# one chain (wrapper shell → npm → node, or su → sh → node) = one bridge: count only the deepest marked process of a
# chain, so its owner (uid) is the real process owner, not the wrapper owner
covered = set()
for pid in kind:
    seen, cur = 0, procs[pid][1]
    while cur in procs and seen < 64:
        if kind.get(cur) == kind[pid]: covered.add(cur)
        cur, seen = procs[cur][1], seen + 1
kids = {}
for pid, (uid, ppid, args) in procs.items(): kids.setdefault(ppid, []).append(pid)
def owner(pid):
    best, stack = procs[pid][0], [(pid, 0)]
    while stack:
        cur, d = stack.pop()
        if d and re.search(r"dist/(server|mcp)\.js", procs[cur][2]): best = procs[cur][0]
        if d < 6: stack.extend((k, d + 1) for k in kids.get(cur, []))
    return best
n = {"bridge": [0, 0, []], "relay": [0, 0, []]}
for pid in sorted(kind, key=int):
    if pid in covered: continue
    k = kind[pid]
    n[k][0 if owner(pid) == me else 1] += 1
    n[k][2].append(pid)
b, r = n["bridge"], n["relay"]
print(b[0], b[1], ",".join(b[2][:5]) or "-", r[0], r[1], ",".join(r[2][:5]) or "-")
'
check_bridges() {
  local res bs bo bp rs ro rp
  if [ -z "$PS_OUT" ]; then cell 주의 "[7] 밖 Slack 다리: 프로세스 목록을 못 읽음" "사람이 ps -eo pid,args | grep channel-server 로 한 번 확인"; return; fi
  if [ -z "$PY" ]; then cell 주의 "[7] 밖 Slack 다리: python3 가 없어 못 셈" "python3 설치 뒤 다시 점검"; return; fi
  res="$(printf '%s\n' "$PS_OUT" | "$PY" -I -B -c "$PY_BRIDGES" "$ROOT" "$ME_UID" 2>/dev/null)"
  set -- $res
  if [ $# -ne 6 ]; then cell 주의 "[7] 밖 Slack 다리: 셈 실패" "사람이 ps -eo pid,args | grep channel-server 로 한 번 확인"; return; fi
  bs="$1"; bo="$2"; bp="$3"; rs="$4"; ro="$5"; rp="$6"
  if [ $((bs + bo)) -gt 0 ]; then
    cell 실패 "[7] 설치 밖에서 켠 Slack 다리 $((bs + bo))개(같은 사용자 $bs, 다른 사용자 $bo, pid $bp) — 같은 Slack 앱이면 메시지가 갈려 한쪽이 못 받음" \
      "예전 방식으로 켠 그 봇 창을 닫거나 끄기(다른 사용자 것은 그 사용자로) · 다른 Slack 앱이 확실하면 그대로 둠"
  elif [ $((rs + ro)) -gt 0 ]; then
    cell 주의 "[7] 옛 봇 창이 열려 있음(Slack 중계 부품 mcp.js $((rs + ro))개, 같은 사용자 $rs, 다른 사용자 $ro, pid $rp · 다리 본체는 없음)" "그 옛 봇 창(예전 방식 Claude 창) 닫기"
  else
    cell OK "[7] 설치 밖 Slack 다리 없음" "할 것 없음"
  fi
}

# ── [8] 옛 ThisCode 훅 · 플러그인 ────────────────────────────────────────────────────────────────────────────────────
# 설정 파일 안 훅에서 ${CLAUDE_PLUGIN_ROOT} 는 비어 «/hooks/lib/bot-only.sh» 가 된다 = «bot-only.sh: No such file or directory» 의 원인.
PY_THISCODE='
import json, os, re, sys
home = os.path.expanduser("~")
seen = tot = broken = 0; plugins = []; bad = []; where = []
for f in sys.argv[1:]:
    try:
        with open(f, encoding="utf-8") as fh: d = json.load(fh)
    except FileNotFoundError: continue
    except Exception: bad.append(f.replace(home, "~", 1)); continue
    seen += 1; here = 0
    if not isinstance(d, dict): continue
    h = d.get("hooks")
    for groups in (h.values() if isinstance(h, dict) else []):
        for g in (groups if isinstance(groups, list) else []):
            for x in ((g.get("hooks") or []) if isinstance(g, dict) else []):
                c = x.get("command", "") if isinstance(x, dict) else ""
                if not isinstance(c, str) or "bot-only.sh" not in c: continue
                tot += 1; here += 1
                m = re.search(r"([^\s\"\x27]*bot-only\.sh)", c)
                p = m.group(1) if m else ""
                lit = "CLAUDE_PLUGIN_ROOT" in p
                p = re.sub(r"\$\{?CLAUDE_PLUGIN_ROOT\}?", "", p)
                p = re.sub(r"\$\{?HOME\}?", home, p)
                p = os.path.expanduser(p)
                if lit or not p or not os.path.isfile(p): broken += 1
    if here: where.append(f.replace(home, "~", 1))
    ep = d.get("enabledPlugins")
    for k, v in (ep.items() if isinstance(ep, dict) else []):
        if isinstance(k, str) and k.lower().startswith("thiscode@") and v is True: plugins.append(k)
print(seen, tot, broken, len(plugins), len(bad))
print(",".join(where) or "-")
print(",".join(plugins) or "-")
print(",".join(bad) or "-")
'
# K24: an official channel plugin (telegram · discord · imessage · fakechat) switched on for a bot also starts inside that
# bot — the kit's bot launch does not isolate plugins — and grabs the same token as the person's existing channel bot (the
# Telegram one takes over the poller on start). Effective state per bot: account settings, then the bot folder's
# .claude/settings.json, then its .claude/settings.local.json (later wins — measured: a folder «false» beats an account «true»).
# A channel the bot loads on purpose (config bots[].extra_channels → launch.sh SM_EXTRA_CHANNELS «plugin:<name>@<source>»)
# is not counted (WSL test machine 10-25: a bot with telegram·discord on purpose was told to switch its own channel off).
# Args: account files… [--bot NAME "EXTRA CHANNELS" project-file local-file]… → line 1 «bot: plugin · …» or «-» · line 2 keys
PY_CHANPLUG='
import json, sys
KEYS = ("telegram", "discord", "imessage", "fakechat")
def plug(f):
    try:
        with open(f, encoding="utf-8") as fh: d = json.load(fh)
    except Exception: return {}
    ep = d.get("enabledPlugins") if isinstance(d, dict) else None
    out = {}
    for k, v in (ep.items() if isinstance(ep, dict) else []):
        if isinstance(k, str) and isinstance(v, bool):
            n, _, m = k.partition("@")
            if m == "claude-plugins-official" and n in KEYS: out[n] = v
    return out
a = sys.argv[1:]; i = 0; acct = {}
while i < len(a) and a[i] != "--bot":
    acct.update(plug(a[i])); i += 1
hits = []; on = []
while i + 2 < len(a):
    name = a[i + 1]; meant = set(a[i + 2].split()); i += 3; eff = dict(acct)
    while i < len(a) and a[i] != "--bot":
        eff.update(plug(a[i])); i += 1
    for n in KEYS:
        if eff.get(n) is True and "plugin:%s@claude-plugins-official" % n not in meant:
            hits.append("%s: %s" % (name, n))
            if n not in on: on.append(n)
print(" · ".join(hits) or "-")
print(", ".join("\"%s@claude-plugins-official\": false" % n for n in on) or "-")
'
check_thiscode() {
  local files b wd res seen tot broken np nbad where plugins badf lvl what fix chan chanfix
  local cargs=()
  if [ -z "$PY" ]; then cell 주의 "[8] 옛 ThisCode 훅: python3 가 없어 못 읽음" "python3 설치 뒤 다시 점검"; return; fi
  files="$HOME/.claude/settings.json
$HOME/.claude/settings.local.json"
  cargs=("$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json")
  for b in $BOT_LIST; do
    wd="$(launch_var "$b" SM_WORK_DIR)" || continue
    [ -n "$wd" ] && files="$files
$wd/.claude/settings.json
$wd/.claude/settings.local.json"
    [ -n "$wd" ] && cargs+=(--bot "$b" "$(launch_var "$b" SM_EXTRA_CHANNELS)" "$wd/.claude/settings.json" "$wd/.claude/settings.local.json")
  done
  res="$(printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 "$PY" -I -B -c "$PY_THISCODE" 2>/dev/null)"
  chan="$("$PY" -I -B -c "$PY_CHANPLUG" "${cargs[@]}" 2>/dev/null)"
  chanfix="$(printf '%s\n' "$chan" | sed -n 2p)"; chan="$(printf '%s\n' "$chan" | sed -n 1p)"
  seen="$(printf '%s\n' "$res" | sed -n 1p)"
  where="$(printf '%s\n' "$res" | sed -n 2p)"; plugins="$(printf '%s\n' "$res" | sed -n 3p)"; badf="$(printf '%s\n' "$res" | sed -n 4p)"
  set -- $seen
  if [ $# -lt 5 ]; then cell 주의 "[8] 옛 ThisCode 훅: 설정 파일 읽기 실패" "사람이 Claude 안에서 /hooks 로 bot-only 든 줄이 있는지 한 번 보기"; return; fi
  tot="$2"; broken="$3"; np="$4"; nbad="$5"
  lvl=OK; what=""; fix=""
  if [ "$broken" -gt 0 ]; then
    lvl=실패
    what="옛 ThisCode 훅 ${tot}줄이 설정에 남아 있고 그중 ${broken}줄은 가리키는 파일이 없음($where) — 화면 오류 «bot-only.sh: No such file» 의 원인"
    fix="그 설정 파일을 백업한 뒤 hooks 안 bot-only 든 줄 지우기(Claude 안 /hooks 에서도 보임)"
  elif [ "$tot" -gt 0 ]; then
    lvl=주의
    what="옛 ThisCode 훅 ${tot}줄이 설정에 남아 있음($where · 파일은 있음 · 봇에도 끼어 돎)"
    fix="안 쓰면 그 설정 파일을 백업한 뒤 hooks 안 bot-only 든 줄 지우기"
  fi
  if [ "$np" -gt 0 ]; then
    [ "$lvl" = OK ] && lvl=주의
    what="${what:+$what, 그리고 }ThisCode 플러그인 켜짐($plugins)"
    fix="${fix:+$fix, 그리고 }Claude 안에서 /plugin 열고 thiscode 끄기"
  fi
  if [ "$nbad" -gt 0 ]; then
    [ "$lvl" = OK ] && lvl=주의
    what="${what:+$what, 그리고 }설정 파일 JSON 이 깨져 못 읽음($badf · Claude 도 못 읽음)"
    fix="${fix:+$fix, 그리고 }그 파일을 사람이 열어 쉼표·괄호 확인"
  fi
  if [ -n "$chan" ] && [ "$chan" != - ]; then
    [ "$lvl" = OK ] && lvl=주의
    what="${what:+$what, 그리고 }다른 채널 플러그인이 봇에도 켜짐($chan) — 봇이 켜질 때 같이 켜져 기존 텔레그램·디스코드 봇과 같은 토큰을 다툼(텔레그램은 기존 연결이 끊김)"
    fix="${fix:+$fix, 그리고 }봇이 일부러 쓰는 채널이면 config 의 그 봇 extra_channels 에 넣고 install 다시(그러면 이 칸이 안 셈) · 아니면 그 봇 폴더 .claude/settings.local.json 의 \"enabledPlugins\" 안에 $chanfix 넣기(그 폴더에서 여는 Claude 창 모두에서 꺼짐 — 그 폴더를 다른 창과 같이 쓰면 그쪽도)"
  fi
  if [ "$lvl" = OK ]; then cell OK "[8] 옛 ThisCode 훅·플러그인 없음 · 봇에 켜진 다른 채널 플러그인 없음(설정 파일 ${1}개 확인)" "할 것 없음"
  else cell "$lvl" "[8] $what" "$fix"; fi
}

# ── [9] 봇별 켜짐 · 창 · 연결 (slackmod status 그대로 읽음) ──────────────────────────────────────────────────────────
STATUS=""
read_status() { installed && STATUS="$(SLACKMOD_ROOT="$ROOT" to 30 bash "$SM" status 2>/dev/null | sed 1d)"; }
status_col() { printf '%s\n' "$STATUS" | awk -v b="$1" -v c="$2" '$1 == b { print $c; exit }'; }
# last_conn <server.log> → "<kind>|<ISO time>|<Slack error code>" of the last connection line, or empty.
# Only these three pieces leave the log (kind = one of five fixed words · time = digits · code = a-z_ like invalid_auth).
last_conn() {
  local l k t c
  [ -f "$1" ] || return 0
  l="$(tail -n 2000 "$1" 2>/dev/null | LC_ALL=C grep -E '\[slack\] socket (connected|disconnected|reconnecting)|\[slack\] socket mode error|\[server\] failed to start Slack bridge' | tail -n 1)"
  [ -n "$l" ] || return 0
  k="$(printf '%s' "$l" | LC_ALL=C sed -nE 's/^\[[^]]*\] \[(slack|server)\] (socket connected|socket disconnected|socket reconnecting|socket mode error|failed to start Slack bridge).*/\2/p')"
  t="$(printf '%s' "$l" | LC_ALL=C sed -nE 's/^\[([0-9T:.Z-]{10,30})\].*/\1/p')"
  c="$(printf '%s' "$l" | LC_ALL=C sed -nE 's/.*An API error occurred: ([a-z_]{3,40}).*/\1/p')"
  printf '%s|%s|%s' "$k" "$t" "$c"
}
# bridge_alive <pane pid> → 0 when that process or one under it (≤6 levels) runs …/channel-server/dist/server.js.
# The bridge window keeps a shell open after the bridge stops, and the connection file can stay behind — so window + file alone can say OK for a dead bridge.
bridge_alive() {
  printf '%s\n' "$PS_OUT" | awk -v top="$1" '
    { pid = $2; pp[pid] = $3; a = $0; sub(/^[ \t]*[-0-9]+[ \t]+[0-9]+[ \t]+[0-9]+[ \t]*/, "", a)
      if (a ~ /channel-server\/dist\/server\.js/) hit[pid] = 1 }
    END { f = 1
      for (p in hit) { c = p
        for (d = 0; d < 7; d++) { if (c == top) { f = 0; break }; if (!(c in pp)) break; c = pp[c] }
        if (!f) break }
      exit f }'
}
check_bots() {
  local b up sock wins hasb hasm alive ppid_b lc kind when code rest one fs worst=OK parts="" fixes=""
  why_skip 9 "봇 켜짐·창·연결" slack && return
  if ! command -v tmux >/dev/null 2>&1; then cell 건너뜀 "[9] 봇 켜짐·창·연결: tmux 가 없어 창 상태를 못 봄([1] 칸 참고)" "창 도구부터 갖추기([1] 칸)"; return; fi
  for b in $BOT_LIST; do
    up="$(status_col "$b" 2)"; sock="$(status_col "$b" 3)"
    wins="$(tmux list-windows -t "=$b" -F '#{window_name}' 2>/dev/null)"
    hasb=0; hasm=0
    printf '%s\n' "$wins" | grep -qx bridge && hasb=1
    printf '%s\n' "$wins" | grep -qx main && hasm=1
    alive=1
    if [ "$hasb" = 1 ]; then
      ppid_b="$(tmux list-panes -t "=$b:bridge" -F '#{pane_pid}' 2>/dev/null | head -n 1)"
      if [ -n "$ppid_b" ] && [ -n "$PS_OUT" ]; then bridge_alive "$ppid_b" || alive=0; fi
    fi
    lc="$(last_conn "$ROOT/bots/$b/slack/server.log")"
    kind="${lc%%|*}"; rest="${lc#*|}"; when="${rest%%|*}"; code="${rest#*|}"
    [ -n "$lc" ] || { kind=""; when=""; code=""; }
    if [ "$up" != 켜짐 ]; then
      one="$b 꺼짐"
      [ "$worst" = OK ] && worst=주의
      fixes="${fixes:+$fixes ; }$b 켜기(slackmod start $b)"
    elif [ "$hasb" = 0 ] || [ "$hasm" = 0 ] || [ "$sock" != 있음 ] || [ "$alive" = 0 ]; then
      one="$b 켜짐인데 $( [ "$hasb" = 1 ] && echo '' || echo 'bridge 창 없음 ')$( [ "$hasm" = 1 ] && echo '' || echo 'main 창 없음 ')$( [ "$sock" = 있음 ] && echo '' || echo '다리 연결 파일 없음 ')$( [ "$alive" = 0 ] && echo 'bridge 창에 다리 프로그램이 안 돎(꺼진 뒤 빈 창)' || echo '')"
      worst=실패
      fixes="${fixes:+$fixes ; }slackmod stop $b ; slackmod start $b"
    else
      one="$b 켜짐 bridge·main 창 있음"
    fi
    if [ "$up" = 켜짐 ]; then
      case "$kind" in
        "socket connected") one="$one, 마지막 연결 줄 «socket connected» $when" ;;
        "socket reconnecting") one="$one, 마지막 연결 줄 «socket reconnecting» $when"; [ "$worst" = OK ] && worst=주의
          fixes="${fixes:+$fixes ; }$b 다리 창(slackmod attach $b → Ctrl+b 0) 마지막 줄 보기" ;;
        "socket disconnected"|"socket mode error"|"failed to start Slack bridge")
          one="$one, 마지막 연결 줄 «${kind}»${code:+(${code})} $when"; worst=실패
          case "$code" in
            invalid_auth|not_authed|account_inactive|token_revoked|token_expired)
              fixes="${fixes:+$fixes ; }$b 토큰이 틀리거나 막힘(${code}) → slackmod set-token $b 뒤 slackmod stop $b ; slackmod start $b" ;;
            *) fixes="${fixes:+$fixes ; }$b 다리 창(slackmod attach $b → Ctrl+b 0) 마지막 줄 보기(토큰 · 앱 이벤트 켜짐 · 채널 초대)" ;;
          esac ;;
        *) one="$one, 연결 기록 아직 없음"; [ "$worst" = OK ] && worst=주의
          fixes="${fixes:+$fixes ; }$b 다리 창(slackmod attach $b → Ctrl+b 0) 보기" ;;
      esac
    fi
    # K19: a fresh Claude Code waits on a first-start screen (status 켜짐 · bridge connected · yet it never answers).
    # Visible screen only — the scrollback keeps dialogs that were already answered.
    if [ "$up" = 켜짐 ] && [ "$hasm" = 1 ]; then
      fs=""
      case "$(tmux capture-pane -p -t "=$b:main" 2>/dev/null)" in
        *"Yes, I trust this folder"*) fs="폴더 신뢰" ;;
        *"Yes, I accept"*) fs="권한 건너뛰기 경고" ;;
        *"I am using this for local development"*) fs="개발 채널 확인" ;;
        *"New MCP server found"*) fs="MCP 서버 승인" ;;   # K19b: a .mcp.json server the kit did not add (its own is pre-approved)
      esac
      if [ -n "$fs" ]; then
        one="$one, $b 봇 창이 처음 켜기 확인(${fs})에서 기다림 — Slack 글에 답 못 함"; worst=실패
        if [ "$fs" = "개발 채널 확인" ]; then
          fixes="${fixes:+$fixes ; }slackmod attach $b → «1» 고른 채 Enter (켤 때마다 묻는 확인 · slackmod start 가 보통 대신 고름)"
        elif [ "$fs" = "MCP 서버 승인" ]; then
          fixes="${fixes:+$fixes ; }slackmod attach $b → 위 화살표로 «Use this MCP server» → Enter (그냥 Enter = 그 서버 없이 계속)"
        else
          fixes="${fixes:+$fixes ; }slackmod attach $b → 아래 화살표로 «Yes» → Enter (그냥 Enter = «No, exit» = 봇 꺼짐 · 처음 한 번만)"
        fi
      fi
    fi
    parts="${parts:+$parts; }$one"
  done
  cell "$worst" "[9] $parts" "${fixes:-할 것 없음}"
}

# ── [10] WSL 이면 Windows 쪽 다리 (slackmod check-windows 그대로) ────────────────────────────────────────────────────
check_windows_side() {
  local out rc first
  if ! is_wsl; then cell 건너뜀 "[10] WSL 이 아님($OSNAME) — Windows 쪽 확인할 것 없음" "해당 없음"; return; fi
  if ! installed; then cell 건너뜀 "[10] Windows 쪽 다리: 설치가 안 보여 못 봄" "설치 뒤 다시 점검"; return; fi
  out="$(SLACKMOD_ROOT="$ROOT" to 40 bash "$SM" check-windows 2>/dev/null </dev/null)"; rc=$?
  first="$(printf '%s\n' "$out" | tr -d '\r' | grep -v '^참고:' | sed -n 1p | cut -c1-200)"   # K21: the relay note is not the cell's line ([7] says relays)
  case "$rc" in
    0) cell OK "[10] Windows 쪽 Slack 다리 안 보임" "할 것 없음" ;;
    1) cell 실패 "[10] 겹침: $first" "Windows 쪽 봇 창(배치 파일로 연 창)을 닫기 · 다른 Slack 앱이 확실하면 그대로 둠" ;;
    2) cell 주의 "[10] ${first:-Windows 쪽을 확인 못 함}" "Windows 작업 관리자에서 node.exe · 봇 창을 사람이 확인" ;;
    *) cell 주의 "[10] Windows 쪽 확인이 시간 안에 안 끝남(끝 코드 $rc)" "Windows 작업 관리자에서 node.exe · 봇 창을 사람이 확인" ;;
  esac
}

# ── [11] Mod 화면 «예약 · 읽기 실패» 줄 ──────────────────────────────────────────────────────────────────────────────
# Mod 화면 예약 칸은 맥 예약 도구(launchctl list)를 읽는다. 리눅스·WSL 엔 그 도구가 없어 늘 «예약 · 읽기 실패 · launchctl …»
# 가 빨갛게 뜬다 = 표시만의 오류 · 봇 · Slack 동작과 무관.
check_cron_band() {
  if ! command -v launchctl >/dev/null 2>&1; then
    cell 건너뜀 "[11] 맥 예약 도구(launchctl)가 없는 기계(리눅스·WSL) — Mod 화면의 «예약 · 읽기 실패 · launchctl …» 빨간 줄은 표시만의 오류이고 봇·Slack 은 정상" "할 것 없음(무시해도 됨)"
  elif to 15 launchctl list >/dev/null 2>&1; then
    cell OK "[11] 맥 예약 목록 읽힘 — Mod 화면 «예약» 칸 정상(잠깐 «읽기 실패» 가 보이면 다음 수집 때 사라짐)" "할 것 없음"
  else
    cell 주의 "[11] 맥 예약 목록(launchctl list)을 못 읽음 — Mod 화면에 «예약 · 읽기 실패» 가 뜸 · 봇·Slack 동작과는 무관" "급하지 않음 · 맥을 다시 켠 뒤 다시 점검"
  fi
}

# ── [12] 채널 기능 (④ 채널 기능 꺼짐) ────────────────────────────────────────────────────────────────────────────────
# Slack 글이 봇에 들어오는 길 = Claude Code 의 «채널» 기능. 꺼지면 «--dangerously-load-development-channels ignored ·
# Channels are not currently available» 가 시작 화면에 뜨고 Slack 글이 봇에 안 들어온다. 꺼지는 경우:
#   · 관리 설정(managed-settings.json · managed-settings.d/*.json)의 channelsEnabled 가 false(개발용 플래그도 막힘)
#   · 로그인 방식이 Bedrock · Vertex · Foundry(채널은 claude.ai 로그인 또는 Console API 키에서만)
#   · 중계·대리 로그인(ANTHROPIC_AUTH_TOKEN · ANTHROPIC_BASE_URL)이면 꺼질 수 있음
#   · Team/Enterprise 는 조직 Owner 가 Organization settings > Claude Code > Channels 를 켜야 함(여기서는 못 읽음)
# 값(열쇠 · 주소)은 읽지도 찍지도 않는다 — 변수 «이름»만. 관리 설정 자리는 SLACKMOD_DOCTOR_MANAGED_DIR 로 바꿀 수 있다(시험용).
PY_CHANNELS_MANAGED='
import glob, json, os, sys
off = bad = ""
for d in sys.argv[1:]:
    files = [os.path.join(d, "managed-settings.json")] + sorted(glob.glob(os.path.join(d, "managed-settings.d", "*.json")))
    for f in files:
        if not os.path.isfile(f): continue
        try:
            with open(f, encoding="utf-8") as fh: j = json.load(fh)
        except Exception:
            bad = bad or f
            continue
        if isinstance(j, dict) and "channelsEnabled" in j:
            off = f if j["channelsEnabled"] is False else ""
print(off or "-")
print(bad or "-")
'
PY_ENV_BLOCK='
import json, sys
names = sys.argv[1].split(",")
hit = set()
for f in sys.argv[2:]:
    try:
        with open(f, encoding="utf-8") as fh: d = json.load(fh)
    except Exception: continue
    e = d.get("env") if isinstance(d, dict) else None
    if isinstance(e, dict):
        for k in names:
            if k in e: hit.add(k)
print(",".join(sorted(hit)))
'
# The two phrases that mean «off». A healthy start screen also shows «server:slack-channel · no MCP server configured with that name»
# and «restart without --dangerously-load-development-channels to stop»: those are normal and must NOT match (the second has no «ignored»).
CH_TRACE='Channels are not currently available|development-channels ignored'
CH_HARD="CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY"
CH_SOFT="ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL"
settings_files() { # the Claude settings files a bot session would read: user + each bot folder
  local b wd
  printf '%s\n' "$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json"
  for b in $BOT_LIST; do
    wd="$(launch_var "$b" SM_WORK_DIR)" || continue
    [ -n "$wd" ] && printf '%s\n' "$wd/.claude/settings.json" "$wd/.claude/settings.local.json"
  done
}
env_name_sources() { # env_name_sources "<NAME NAME…>" → «NAME(출처) NAME(출처)» for names set in the environment · the window tool's global environment · a settings env block
  local n out="" v genv="" blk=""
  if command -v tmux >/dev/null 2>&1; then genv="$(tmux show-environment -g 2>/dev/null | LC_ALL=C sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p')"; fi
  [ -n "$PY" ] && blk=",$(settings_files | tr '\n' '\0' | xargs -0 "$PY" -I -B -c "$PY_ENV_BLOCK" "$(printf '%s' "$1" | tr ' ' ',')" 2>/dev/null),"
  for n in $1; do
    v="${!n-}"
    [ -n "$v" ] && out="${out:+$out }$n(환경 변수)"
    printf '%s\n' "$genv" | grep -qx "$n" && out="${out:+$out }$n(창 도구 전역 환경)"
    case "$blk" in *",$n,"*) out="${out:+$out }$n(설정 파일 env)" ;; esac
  done
  printf '%s' "$out"
}
check_channels() {
  local mgd="" off bad hard soft b trace="" parts="" fix="" lvl=OK pane res
  why_skip 12 "채널 기능" slack && return
  if [ -z "$PY" ]; then cell 주의 "[12] 채널 기능: python3 가 없어 못 읽음" "python3 설치 뒤 다시 점검"; return; fi
  if [ -n "${SLACKMOD_DOCTOR_MANAGED_DIR:-}" ]; then mgd="${SLACKMOD_DOCTOR_MANAGED_DIR}"
  else mgd="/Library/Application Support/ClaudeCode
/etc/claude-code"; fi
  res="$(printf '%s\n' "$mgd" | tr '\n' '\0' | xargs -0 "$PY" -I -B -c "$PY_CHANNELS_MANAGED" 2>/dev/null)"
  off="$(printf '%s\n' "$res" | sed -n 1p)"; bad="$(printf '%s\n' "$res" | sed -n 2p)"
  hard="$(env_name_sources "$CH_HARD")"; soft="$(env_name_sources "$CH_SOFT")"
  for b in $BOT_LIST; do
    if [ -f "$ROOT/bots/$b/slack/server.log" ] && tail -n 2000 "$ROOT/bots/$b/slack/server.log" 2>/dev/null | LC_ALL=C grep -qiE "$CH_TRACE"; then trace="${trace:+$trace, }$b 의 다리 기록"; continue; fi
    if command -v tmux >/dev/null 2>&1; then
      pane="$(tmux capture-pane -p -t "=$b:main" -S -300 2>/dev/null | LC_ALL=C grep -ciE "$CH_TRACE")"
      [ "${pane:-0}" -gt 0 ] && trace="${trace:+$trace, }$b 의 봇 화면"
    fi
  done
  if [ -n "$off" ] && [ "$off" != - ]; then
    lvl=실패; parts="④ 채널 기능 꺼짐 — 조직 관리자가 채널을 꺼 둠(관리 설정 파일 $off 의 channelsEnabled 가 false · 개발용 플래그도 막힘)"
    fix="조직 Owner 에게 채널을 켜 달라고 요청(Team/Enterprise: Organization settings > Claude Code > Channels · 관리 설정의 channelsEnabled)"
  fi
  if [ -n "$hard" ]; then
    lvl=실패; parts="${parts:+$parts; }④ 채널 기능 꺼짐 — 이 로그인 방식에선 채널이 안 됨(Bedrock · Vertex · Foundry 쪽 변수: $hard)"
    fix="${fix:+$fix ; }그 변수를 빼고 claude.ai 로그인(또는 Console API 키)으로 켜기 — 채널은 그 둘에서만 됨"
  fi
  if [ -n "$trace" ]; then
    lvl=실패; parts="${parts:+$parts; }④ 채널 기능 꺼짐 — «Channels are not currently available» 또는 «development-channels ignored» 가 찍혀 있음($trace)"
    fix="${fix:+$fix ; }위 원인(관리 설정 · 로그인 방식)을 고친 뒤 slackmod stop 봇이름 ; slackmod start 봇이름"
  fi
  if [ -n "$soft" ]; then
    [ "$lvl" = OK ] && lvl=주의; parts="${parts:+$parts; }중계·대리 로그인이면 채널이 꺼질 수 있음(변수: $soft)"
    fix="${fix:+$fix ; }claude.ai 로그인 권장: 그 변수를 빼고 claude 안 /login 1회"
  fi
  if [ -n "$bad" ] && [ "$bad" != - ]; then
    [ "$lvl" = OK ] && lvl=주의; parts="${parts:+$parts; }관리 설정 파일을 못 읽음($bad)"
    fix="${fix:+$fix ; }그 파일의 JSON 꼴을 관리자에게 확인"
  fi
  if [ "$lvl" = OK ]; then cell OK "[12] 채널 기능이 꺼질 만한 원인이 안 보임(관리 설정 channelsEnabled · 로그인 방식 변수 · 채널 꺼짐 흔적 모두 해당 없음)" "할 것 없음(시작 화면의 «no MCP server configured with that name» 줄은 정상 — Slack 글이 들어오면 무시 · Team/Enterprise 는 조직 Owner 가 Organization settings > Claude Code > Channels 를 켜야 함 — 여기서는 못 읽음)"
  else cell "$lvl" "[12] $parts" "$fix"; fi
}

# ── [13] 관문 파일 확인 값 (고정 지문) ──────────────────────────────────────────────────────────────────────────────────────
# Each bot's harness.json pins its gate files by sha256 — every <x>Path + <x>Sha256 pair of every policy (sourcePath · directionPath
# · …) and pinnedSiblings (a stale directionSha256 blocks only some calls, so it is checked like the source). A file
# that changed, became group/other-writable or is gone makes the harness refuse EVERY tool call of that bot. This cell names the
# file and the same one fix line the block message shows (repinHint) — it never re-pins (the doctor writes nothing).
# The python below prints the finished cell as three lines: level (OK|주의|건너뜀) · what · fix.
PY_PINS='
import hashlib, json, os, stat, sys
root, bots = sys.argv[1], sys.argv[2:]
nok, bad, fix = 0, [], ""
for b in bots:
    try:
        with open(os.path.join(root, "bots", b, "harness.json"), encoding="utf-8") as f:
            h = json.load(f)
    except (OSError, ValueError):
        bad.append("봇 설정(harness.json)을 못 읽음: " + b); continue
    opts = (h.get("hooks") or {}).get("policyOptions") or {}
    for key in sorted(opts):
        o = opts[key]
        if not isinstance(o, dict):
            continue
        pins = [(o[k], o[k[:-4] + "Sha256"]) for k in sorted(o) if k.endswith("Path") and isinstance(o[k], str) and isinstance(o.get(k[:-4] + "Sha256"), str)]
        sib = o.get("pinnedSiblings")
        pins += [(p, d) for p, d in sorted(sib.items()) if isinstance(p, str) and isinstance(d, str)] if isinstance(sib, dict) else []
        hint = o.get("repinHint")
        hint = hint if isinstance(hint, str) and hint and "\n" not in hint and len(hint) <= 200 else "이 파일을 직접 고친 게 맞을 때만 설정 hooks.policyOptions 에서 그 파일의 확인 값(…Sha256)을 이 파일의 새 sha256 으로 바꾸기"
        for p, d in pins:
            name = os.path.basename(p)
            try:
                st = os.lstat(p)
                ok_file = stat.S_ISREG(st.st_mode)
            except OSError:
                ok_file = False
            if not ok_file:
                bad.append("고정 파일이 없음: %s 의 %s" % (b, name)); fix = fix or "다시 맞추기 = " + hint; continue
            if st.st_mode & 0o022:
                bad.append("권한이 느슨함: %s 의 %s (그룹·다른 사용자가 고칠 수 있음)" % (b, name)); fix = fix or "그 파일에 chmod go-w (내용 · 확인 값은 그대로)"; continue
            with open(p, "rb") as f:
                got = hashlib.sha256(f.read()).hexdigest()
            if got == d:
                nok += 1
            else:
                bad.append("확인 값이 안 맞음: %s 의 %s" % (b, name)); fix = "다시 맞추기 = " + hint
if bad:
    print("주의"); print("[13] " + "; ".join(bad) + " — 이대로면 그 봇의 도구 호출이 모두 막힘"); print(fix or "다시 맞추기 = 이 파일을 직접 고친 게 맞을 때만 설정 hooks.policyOptions 에서 그 파일의 확인 값(…Sha256)을 이 파일의 새 sha256 으로 바꾸기")
elif nok:
    print("OK"); print("[13] 관문 파일 확인 값이 맞음(봇 %d · 고정 파일 %d)" % (len(bots), nok)); print("할 것 없음")
else:
    print("건너뜀"); print("[13] 관문 파일 확인 값: 고정된 파일이 없음"); print("할 것 없음")
'
check_pins() {
  local res lv what fix
  why_skip 13 "관문 파일 확인 값" && return
  if [ -z "$PY" ]; then cell 주의 "[13] 관문 파일 확인 값: python3 가 없어 못 읽음" "python3 설치 뒤 다시 점검"; return; fi
  # shellcheck disable=SC2086
  res="$("$PY" -I -B -c "$PY_PINS" "$ROOT" $BOT_LIST 2>/dev/null)"
  lv="$(printf '%s\n' "$res" | sed -n 1p)"; what="$(printf '%s\n' "$res" | sed -n 2p)"; fix="$(printf '%s\n' "$res" | sed -n 3p)"
  case "$lv" in OK|주의|건너뜀) cell "$lv" "$what" "$fix" ;; *) cell 주의 "[13] 관문 파일 확인 값: 읽다가 멈춤" "python3 -I 로 봇 설정을 읽을 수 있는지 확인 뒤 다시 점검" ;; esac
}

[ -n "$PY" ] || CANT=1
BOT_LIST="$(bots)"
read_status
if [ -n "$BOT_LIST" ] && [ "$SLACK_OFF" = 0 ] && installed; then slack_probe; fi
check_window_tool
check_login
check_tokens
check_persona
check_slack_roundtrip
check_invite
check_bridges
check_thiscode
check_bots
check_windows_side
check_cron_band
check_channels
check_pins
emit "할 일 · 사람이 할 1가지: 시험 채널에 봇을 부르는 글 1개(@봇이름 + 한마디) → 그 글에 눈(👀) · 확인(✅) 반응이 붙고 봇 답이 오면 끝 · 안 오면 이 점검을 다시"
emit "요약: OK $N_OK · 주의 $N_WARN · 실패 $N_FAIL · 건너뜀 $N_SKIP"

# last guard: anything shaped like a token or key is masked before printing (the cells above never read values into the output)
printf '%s' "$OUT" | LC_ALL=C sed -E 's/xox[a-zA-Z]-[A-Za-z0-9-]+/xox?-(가림)/g; s/xapp-[A-Za-z0-9-]+/xapp-(가림)/g; s/sk-ant-[A-Za-z0-9_-]+/sk-ant-(가림)/g; s/gh[pousr]_[A-Za-z0-9]{20,}/gh?_(가림)/g; s/github_pat_[A-Za-z0-9_]{20,}/github_pat_(가림)/g; s/AKIA[0-9A-Z]{16}/AKIA(가림)/g'

RC=0
if [ "$STRICT" = 1 ]; then
  if [ "$CANT" = 1 ]; then RC=2; elif [ $((N_WARN + N_FAIL)) -gt 0 ]; then RC=1; fi
fi
exit "$RC"
