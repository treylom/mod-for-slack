#!/usr/bin/env bash
# doctor-test.sh — setup/lib/doctor.sh against a fake install, fake Slack answers and stub tools (no network, no real token).
#   /bin/bash setup/tests/doctor-test.sh              (the doctor is run with /bin/bash too: bash 3.2 on a Mac)
#   DOCTOR=/path/to/mutant.sh bash setup/tests/doctor-test.sh      (the mutation runner swaps the doctor)
# rc 0 = every case behaved · 1 = at least one did not. Everything lives under one mktemp dir; HOME is a throwaway one.
# Token-shaped strings are assembled from pieces, so this file never holds one whole.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
DOCTOR="${DOCTOR:-$REPO/setup/lib/doctor.sh}"
PCHECK="${PERSONA_CHECK:-$REPO/setup/lib/persona-check.py}"
PFILL="$REPO/setup/lib/persona-fill.py"
PY="$(command -v python3)"
T="$(mktemp -d "${TMPDIR:-/tmp}/doctor-test.XXXXXX")"
SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && { : > "$T/mode.stop"; sleep 1; kill "$SRV_PID" 2>/dev/null; }; rm -rf "$T"; }
trap cleanup EXIT
HOMED="$T/home"; ROOTD="$HOMED/.slackmod"; mkdir -p "$HOMED" "$T/managed"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; [ -n "${FAILFAST:-}" ] && { printf '\n합계: PASS %d · FAIL %d (FAILFAST: stopped at the first failing case)\n' "$PASS" "$FAIL"; exit 1; }; return 0; }

# ── stub tools ───────────────────────────────────────────────────────────────────────────────────────────────────────
mkbin() { # mkbin <dir> [tmux] [herdr] [claude] — python3 always; the others only when named
  local d="$1"; shift
  rm -rf "$d"; mkdir -p "$d"; ln -s "$PY" "$d/python3"
  local x
  for x in "$@"; do
    case "$x" in
      tmux) cat > "$d/tmux" <<'EOS'
#!/bin/sh
# stub window tool: answers from files under $FAKE_TMUX_DIR
case "$1" in
  -V) echo "tmux 3.9"; exit 0 ;;
  show-environment) [ -f "$FAKE_TMUX_DIR/globalenv" ] && cat "$FAKE_TMUX_DIR/globalenv"; exit 0 ;;
  capture-pane) shift; t=""; while [ $# -gt 0 ]; do [ "$1" = -t ] && { t="$2"; break; }; shift; done
                n="${t#=}"; n="${n%%:*}"; [ -f "$FAKE_TMUX_DIR/pane-$n" ] && cat "$FAKE_TMUX_DIR/pane-$n"; exit 0 ;;
  list-windows) n="${3#=}"; [ -f "$FAKE_TMUX_DIR/windows-$n" ] && cat "$FAKE_TMUX_DIR/windows-$n" || exit 1 ;;
  list-panes) t="${3#=}"; n="${t%%:*}"; [ -f "$FAKE_TMUX_DIR/panepid-$n" ] && cat "$FAKE_TMUX_DIR/panepid-$n" || exit 1 ;;
  *) exit 1 ;;
esac
EOS
        ;;
      herdr) printf '#!/bin/sh\nexit 0\n' > "$d/herdr" ;;
      claude) cat > "$d/claude" <<'EOS'
#!/bin/sh
# stub claude: «auth status --json» prints the file FAKE_CLAUDE_STATUS
[ "$1 $2" = "auth status" ] && { cat "$FAKE_CLAUDE_STATUS"; exit 0; }
exit 0
EOS
        ;;
      launchctl) printf '#!/bin/sh\nexit 0\n' > "$d/launchctl" ;;
    esac
  done
  chmod 755 "$d"/* 2>/dev/null
}
BIN="$T/bin"; mkbin "$BIN" tmux claude launchctl
FAKETMUX="$T/tmuxfiles"; mkdir -p "$FAKETMUX"
printf '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max", "email": "someone@example.org"}\n' > "$T/claude-ok.json"
cp "$T/claude-ok.json" "$T/claude-status.json"
FAKE="$T/slack"; mkdir -p "$FAKE"
slack_ok() {
  rm -rf "$FAKE"; mkdir -p "$FAKE"
  printf '{"ok": true, "team_id": "TTEST", "user": "bot"}\n' > "$FAKE/auth.test.json"
  printf '{"ok": true, "messages": []}\n' > "$FAKE/conversations.history.json"
  # the standard manifest has no channels:read: a conversations.info answer must never be what decides anything
  printf '{"ok": false, "error": "missing_scope"}\n' > "$FAKE/conversations.info.json"
}
slack_ok
printf '  501  1  0 /sbin/launchd\n' > "$T/ps.txt"

BT1="xo""xb-1111111111-AAAAAAAAAAAA"; AT1="xa""pp-1-A111111111-aaaaaaaaaaaa"
BT2="xo""xb-2222222222-BBBBBBBBBBBB"; AT2="xa""pp-1-A222222222-bbbbbbbbbbbb"
CH="CTEST000001"

# ── fake install ─────────────────────────────────────────────────────────────────────────────────────────────────────
mkbot() { # mkbot <bot> <bot token> <app token> <channel> <work dir>
  local b="$1"
  mkdir -p "$ROOTD/bots/$b/slack"
  printf 'SLACK_BOT_TOKEN=%s\nSLACK_APP_TOKEN=%s\nSLACK_CHANNEL_ID=%s\n' "$2" "$3" "$4" > "$ROOTD/bots/$b/slack/.env"
  chmod 600 "$ROOTD/bots/$b/slack/.env"
  printf "SM_WORK_DIR='%s'\nSM_CLAUDE='%s/claude'\n" "$5" "$BIN" > "$ROOTD/bots/$b/launch.sh"
  # [13] the gate file pin, as install.sh writes it (policyOptions.pinned-legacy · sha256 of hooks/pass.sh · the fix line)
  mkdir -p "$ROOTD/hooks"; [ -f "$ROOTD/hooks/pass.sh" ] || { printf '#!/bin/sh\ncat >/dev/null\nexit 0\n' > "$ROOTD/hooks/pass.sh"; chmod 755 "$ROOTD/hooks/pass.sh"; }
  "$PY" -I -c 'import hashlib, json, sys; r, b = sys.argv[1], sys.argv[2]; p = r + "/hooks/pass.sh"
json.dump({"hooks": {"policyOptions": {"pinned-legacy": {"sourcePath": p, "sourceSha256": hashlib.sha256(open(p, "rb").read()).hexdigest(),
  "interpreter": "sh", "repinHint": "키트 폴더에서 bash install.sh (시험)"}}}}, open(r + "/bots/" + b + "/harness.json", "w"))' "$ROOTD" "$b"
}
mkroot() { # mkroot <bot>... → fresh install with those bots (healthy: tokens, channel, persona folders)
  slack_ok
  rm -rf "$ROOTD" "$T/work" "$HOMED/.claude"; mkdir -p "$ROOTD/bin" "$ROOTD/lib" "$T/work"
  cp "$REPO/port/lib/slackmod_config.py" "$ROOTD/lib/"
  cat > "$ROOTD/bin/slackmod" <<'EOS'
#!/bin/sh
case "$1" in
  status) cat "$SLACKMOD_ROOT/status.txt" ;;
  check-windows) echo "windows side not checked (test stub)"; exit 2 ;;
esac
EOS
  : > "$ROOTD/bots.list"; printf '봇 켜짐 다리 토큰 하위창\n' > "$ROOTD/status.txt"
  rm -f "$FAKETMUX"/*; : > "$T/ps.txt"; printf '  501  1  0 /sbin/launchd\n' > "$T/ps.txt"
  local b i=0 bt at pane
  for b in "$@"; do
    i=$((i + 1))
    if [ "$i" = 1 ]; then bt="$BT1"; at="$AT1"; pane=4242; else bt="$BT2"; at="$AT2"; pane=5252; fi
    printf '%s\n' "$b" >> "$ROOTD/bots.list"
    mkbot "$b" "$bt" "$at" "$CH" "$T/work/$b"
    printf '%s 켜짐 있음 set·set 0\n' "$b" >> "$ROOTD/status.txt"
    printf 'bridge\nmain\n' > "$FAKETMUX/windows-$b"; echo "$pane" > "$FAKETMUX/panepid-$b"
    printf '  501  %s  1 -zsh\n  501  %s  %s node %s/app/channel-server/dist/server.js\n' "$pane" "$((pane + 1))" "$pane" "$ROOTD" >> "$T/ps.txt"
    printf '[2026-10-24T09:00:00.000Z] [slack] socket connected\n' > "$ROOTD/bots/$b/slack/server.log"
  done
  # persona folders from the interview path (fill) so [4] sees the real files
  "$PY" -I - "$T" "$@" > "$T/answers.json" <<'EOF'
import json, sys
t, names = sys.argv[1], sys.argv[2:]
roles = ['lead', 'research', 'watch']
print(json.dumps({'schema': 1, 'bots': [{'name': n, 'role': roles[i % 3], 'tone': '차분한 존댓말', 'dir': '%s/work/%s' % (t, n)} for i, n in enumerate(names)]}))
EOF
  "$PY" -I "$PFILL" --templates "$REPO/setup/templates" --answers "$T/answers.json" --profile "$T/profile-unused.md" > /dev/null
}

# ── runner ───────────────────────────────────────────────────────────────────────────────────────────────────────────
OUT=""; RC=0
run_doctor() { # run_doctor [doctor args] — extra env from DENV (space separated NAME=VALUE)
  OUT="$(env -i HOME="$HOMED" PATH="${PATHDIR:-$BIN}:/usr/bin:/bin" SLACKMOD_ROOT="$ROOTD" SLACKMOD_DOCTOR_PS_FILE="$T/ps.txt" \
    SLACKMOD_PERSONA_CHECK="$PCHECK" SLACKMOD_DOCTOR_FAKE_SLACK="${FAKEDIR-$FAKE}" FAKE_TMUX_DIR="$FAKETMUX" FAKE_CLAUDE_STATUS="$T/claude-status.json" \
    PERSONA_CHECK_TABLE="$REPO/port/lib/traces.tsv" SLACKMOD_DOCTOR_MANAGED_DIR="${MANAGED:-$T/managed}" ${DENV:-} /bin/bash "$DOCTOR" "$@" 2>&1)"; RC=$?
  [ -n "${SHOW:-}" ] && { printf '    ---- doctor rc %s\n' "$RC"; printf '%s\n' "$OUT" | sed 's/^/    | /'; }
  return 0
}
cellline() { grep -E "^(OK|주의|실패|건너뜀) · \\[$1\\] " <<<"$OUT" | head -n 1; }
has() { grep -qF -- "$1" <<<"$OUT"; }
cellhas() { cellline "$1" | grep -qF -- "$2"; }
# level <n> <OK|주의|실패|건너뜀> <label> [text that must be in that cell line]...
level() {
  local n="$1" lv="$2" label="$3" l s; shift 3
  l="$(cellline "$n")"
  case "$l" in "$lv · "*) ;; *) bad "$label (cell [$n] is: ${l:-<missing>})"; return ;; esac
  for s in "$@"; do grep -qF -- "$s" <<<"$l" || { bad "$label (cell [$n] lacks: $s | line: $l)"; return; }; done
  ok "$label"
}
summary_ok() { # summary_ok <label> — «요약» sums to the number of cell lines, which is 13
  local line nums sum cells
  line="$(grep '^요약: ' <<<"$OUT" | tail -n 1)"
  cells="$(grep -cE '^(OK|주의|실패|건너뜀) · \[[0-9]+\] ' <<<"$OUT")"
  nums="$(printf '%s' "$line" | sed -E 's/^요약: OK ([0-9]+) · 주의 ([0-9]+) · 실패 ([0-9]+) · 건너뜀 ([0-9]+)$/\1 \2 \3 \4/')"
  case "$nums" in *[!0-9\ ]*|'') bad "$1 (summary line not in the 4-number shape: $line)"; return ;; esac
  sum=0; for x in $nums; do sum=$((sum + x)); done
  if [ "$sum" = "$cells" ] && [ "$cells" = 13 ]; then ok "$1 · summary sum $sum = cell lines $cells = 13"; else bad "$1 (summary sum $sum · cell lines $cells · want 13)"; fi
}
nolines() { # every output line is one of: header · cell · 할 일 · 요약
  local n; n="$(grep -vcE '^(OK|주의|실패|건너뜀) · \[[0-9]+\] |^상태 점검 · |^할 일 · |^요약: ' <<<"$OUT")"
  [ "$n" = 0 ] && ok "$1 · no stray lines" || { bad "$1 (stray lines: $n)"; grep -vE '^(OK|주의|실패|건너뜀) · \[[0-9]+\] |^상태 점검 · |^할 일 · |^요약: ' <<<"$OUT" | head -3; }
}

# ── 0. shape: bash 3.2 syntax, help ──────────────────────────────────────────────────────────────────────────────────
/bin/bash -n "$DOCTOR" && ok "/bin/bash -n doctor.sh ($(/bin/bash --version | head -n 1 | cut -c1-40))" || bad "/bin/bash -n doctor.sh"

# ── 1. healthy install ───────────────────────────────────────────────────────────────────────────────────────────────
mkroot alpha scout
before="$(find "$HOMED" -type f -exec shasum {} + | sort | shasum)"
run_doctor
summary_ok "healthy"; nolines "healthy"
level 1 OK "healthy [1] window tool" "tmux 3.9"
level 2 OK "healthy [2] login" "정액제 max"
level 3 OK "healthy [3] tokens" "alpha set·set" "scout set·set"
level 4 OK "healthy [4] persona" "alpha 통과" "scout 통과"
level 5 OK "healthy [5] slack round trip" "auth.test 통과"
level 6 OK "healthy [6] invite" "모두 해당 없음" "alpha 정상" "scout 정상"
level 7 OK "healthy [7] outside bridge"
level 8 OK "healthy [8] old hooks"
level 9 OK "healthy [9] bots up" "alpha 켜짐 bridge·main 창 있음" "socket connected"
level 10 건너뜀 "healthy [10] not WSL → 건너뜀" "WSL 이 아님"
level 11 OK "healthy [11] schedule list"
level 12 OK "healthy [12] channel feature" "꺼질 만한 원인이 안 보임" "Organization settings > Claude Code > Channels"
level 13 OK "healthy [13] gate file pins" "확인 값이 맞음(봇 2 · 고정 파일 2)"
has '요약: OK 12 · 주의 0 · 실패 0 · 건너뜀 1' && ok "healthy summary line exact" || bad "healthy summary line exact"
[ "$RC" = 0 ] && ok "healthy: rc 0" || bad "healthy rc $RC"
run_doctor --strict; [ "$RC" = 0 ] && ok "healthy --strict: rc 0 (건너뜀 does not count)" || bad "healthy --strict rc $RC"
after="$(find "$HOMED" -type f -exec shasum {} + | sort | shasum)"
[ "$before" = "$after" ] && ok "read only: file fingerprint unchanged after 2 runs" || bad "read only: files changed"
# [13] bait pair (10-26 · 공개 전 고정 지문): one byte added to the pinned pass.sh → 주의 names the bot, the file and the config's fix
# line · the doctor never re-pins (pass.sh + harness.json bytes unchanged by the run) · put back → OK again
cp -p "$ROOTD/hooks/pass.sh" "$T/pass.keep"; hj="$(shasum "$ROOTD/bots/alpha/harness.json")"
printf '#\n' >> "$ROOTD/hooks/pass.sh"; pj="$(shasum "$ROOTD/hooks/pass.sh")"
run_doctor
level 13 주의 "[13] pinned pass.sh changed by one line → 주의 naming bot + file + the fix line" "확인 값이 안 맞음: alpha 의 pass.sh" "scout 의 pass.sh" "다시 맞추기 = 키트 폴더에서 bash install.sh (시험)" "도구 호출이 모두 막힘"
[ "$(shasum "$ROOTD/hooks/pass.sh")" = "$pj" ] && [ "$(shasum "$ROOTD/bots/alpha/harness.json")" = "$hj" ] && ok "[13] the doctor did not re-pin or restore (pass.sh + harness.json unchanged)" || bad "[13] the doctor changed pass.sh or harness.json"
cp -p "$T/pass.keep" "$ROOTD/hooks/pass.sh"
run_doctor; level 13 OK "[13] pass.sh put back → OK again" "확인 값이 맞음"
chmod 775 "$ROOTD/hooks/pass.sh"; run_doctor
level 13 주의 "[13] group-writable pass.sh (umask 0002) → 주의 «권한이 느슨함» + chmod go-w" "권한이 느슨함: alpha 의 pass.sh" "chmod go-w"
chmod 755 "$ROOTD/hooks/pass.sh"; mv "$ROOTD/hooks/pass.sh" "$T/pass.gone"; run_doctor
level 13 주의 "[13] pass.sh gone → 주의 «고정 파일이 없음» + the fix line" "고정 파일이 없음: alpha 의 pass.sh" "다시 맞추기 = 키트 폴더에서 bash install.sh (시험)"
mv "$T/pass.gone" "$ROOTD/hooks/pass.sh"; summary_ok "[13] bait runs"
# a second policy pinned by a non-source pair (rsync-safety style directionPath / directionSha256 · no repinHint): a stale direction
# pin is named too, with the default fix line · fixed pin → OK
printf 'def direction(c):\n    return 0\n' > "$ROOTD/hooks/direction.py"; chmod 644 "$ROOTD/hooks/direction.py"
"$PY" -I -c 'import hashlib, json, sys; f, d, sha = sys.argv[1], sys.argv[2], sys.argv[3]; h = json.load(open(f))
h["hooks"]["policyOptions"]["rsync-safety"] = {"directionPath": d, "directionSha256": sha}; json.dump(h, open(f, "w"))' \
  "$ROOTD/bots/alpha/harness.json" "$ROOTD/hooks/direction.py" "$(printf 0%.0s $(seq 1 64))"
run_doctor
level 13 주의 "[13] a stale directionSha256 (second policy · no repinHint) → named + the default fix line" "확인 값이 안 맞음: alpha 의 direction.py" "다시 맞추기 = 이 파일을 직접 고친 게 맞을 때만"
"$PY" -I -c 'import hashlib, json, sys; f, d = sys.argv[1], sys.argv[2]; h = json.load(open(f))
h["hooks"]["policyOptions"]["rsync-safety"]["directionSha256"] = hashlib.sha256(open(d, "rb").read()).hexdigest(); json.dump(h, open(f, "w"))' \
  "$ROOTD/bots/alpha/harness.json" "$ROOTD/hooks/direction.py"
run_doctor; level 13 OK "[13] direction pin fixed → OK (봇 2 · 고정 파일 3)" "확인 값이 맞음(봇 2 · 고정 파일 3)"

# ── 2. G9 — three invite-failure branches, each its own wording, never another branch's ────────────────────────────
branch_only() { # branch_only <label> <mark that must be present> <other marks that must not>
  local l; l="$(cellline 6)"; local label="$1" want="$2" m; shift 2
  grep -qF -- "$want" <<<"$l" || { bad "$label (cell [6] lacks $want | $l)"; return; }
  for m in "$@"; do grep -qF -- "$m" <<<"$l" && { bad "$label (cell [6] also has $m)"; return; }; done
  ok "$label"
}
# ① other workspace: channel not visible to the bot
mkroot alpha
printf '{"ok": false, "error": "channel_not_found"}\n' > "$FAKE/conversations.history.json"
run_doctor; summary_ok "G9 ① channel_not_found"
level 6 실패 "G9 ① channel_not_found → 실패 (workspace id from auth.test shown)" "① 다른 워크스페이스(또는 비공개·미초대)" "워크스페이스(TTEST)에서 안 보입니다" "channel_not_found"
branch_only "G9 ① wording only (no ② ③)" "① 다른 워크스페이스" "② 관리자 승인 대기" "③ "
cellhas 6 "비공개 채널이면 먼저 초대" && cellhas 6 "채널 링크의 워크스페이스가 같은지" && ok "G9 ① fix text (G9 table)" || bad "G9 ① fix text"
level 5 OK "G9 ① round trip itself is fine" "auth.test 통과"
run_doctor --strict; [ "$RC" = 1 ] && ok "G9 ① --strict rc 1" || bad "G9 ① --strict rc $RC"
# ② admin approval pending: no bot token, app token present
slack_ok; mkroot alpha
mkbot alpha "xo""xb-REPLACE-ME" "$AT1" "$CH" "$T/work/alpha"
run_doctor
level 6 실패 "G9 ② no bot token (app token present) → 실패" "② 관리자 승인 대기 꼴" "승인 대기입니다" "관리자에게 앱 승인 요청" "slackmod set-token alpha"
branch_only "G9 ② wording only (no ① ③)" "② 관리자 승인 대기" "① 다른 워크스페이스" "③ "
level 3 실패 "G9 ② tokens cell also says 빠짐" "토큰 빠짐"
level 5 건너뜀 "G9 ② round trip skipped (no bot token)" "토큰이 없어"
# ② also when both tokens are blank(G9 table, row 0: «봇 토큰 있음? 없음·빈칸»)
mkroot alpha; mkbot alpha "" "" "$CH" "$T/work/alpha"
run_doctor; level 6 실패 "G9 ② bot token blank, app token blank → ②" "② 관리자 승인 대기 꼴"
# ② also when auth.test says the app is gone: invalid_auth · token_revoked · account_inactive (G9 table row 1)
for ec in invalid_auth token_revoked account_inactive; do
  mkroot alpha; printf '{"ok": false, "error": "%s"}\n' "$ec" > "$FAKE/auth.test.json"
  run_doctor
  level 6 실패 "G9 ② auth.test ${ec} → ② + 토큰을 다시 받으세요" "② 관리자 승인 대기 꼴" "«${ec}»" "토큰을 다시 받으세요"
  branch_only "G9 ② auth.test $ec wording only (no ① ③)" "② 관리자 승인 대기" "① 다른 워크스페이스" "③ "
done
# other auth.test errors are the token cell's business ([5]), not an invite branch
mkroot alpha; printf '{"ok": false, "error": "ratelimited"}\n' > "$FAKE/auth.test.json"
run_doctor; level 5 실패 "other auth.test error → [5] 실패" "ratelimited"
level 6 건너뜀 "other auth.test error → [6] 건너뜀 (no branch claimed)" "[5] 칸 참고"
# ③ guest / channel restriction: bot is not in the channel
slack_ok; mkroot alpha
printf '{"ok": false, "error": "not_in_channel"}\n' > "$FAKE/conversations.history.json"
run_doctor
level 6 실패 "G9 ③ not_in_channel → 실패" "③ 손님 계정·채널 제한" "봇이 채널에 없습니다(not_in_channel)"
branch_only "G9 ③ wording only (no ① ②)" "③ 손님 계정·채널 제한" "① 다른 워크스페이스" "② 관리자 승인 대기"
cellhas 6 "/invite @봇" && cellhas 6 "손님 계정(멀티/싱글 채널 게스트)은 앱을 초대할 수 없으니 정회원이 초대" && ok "G9 ③ fix text (G9 table)" || bad "G9 ③ fix text"
# ③ organisation policy: ekm_access_denied · restricted_action
for ec in ekm_access_denied restricted_action; do
  slack_ok; mkroot alpha; printf '{"ok": false, "error": "%s"}\n' "$ec" > "$FAKE/conversations.history.json"
  run_doctor
  level 6 실패 "G9 ③ policy: history $ec → 실패" "③ 조직 정책 제한" "워크스페이스 정책이 앱의 이 채널 접근을 막습니다" "$ec" "관리자"
  branch_only "G9 ③ policy $ec wording only (no ① ②)" "③ 조직 정책 제한" "① 다른 워크스페이스" "② 관리자 승인 대기"
done
# one bot per branch at once: per-bot answers (a folder per bot), worst level wins, each branch named once
slack_ok; mkroot alpha scout
mkdir -p "$FAKE/scout"; printf '{"ok": false, "error": "not_in_channel"}\n' > "$FAKE/scout/conversations.history.json"
run_doctor
level 6 실패 "G9 per-bot answers: alpha 정상 · scout ③" "alpha 정상" "scout ③ 손님 계정·채널 제한"
# missing scope is a warning, not a branch
slack_ok; mkroot alpha
printf '{"ok": false, "error": "missing_scope"}\n' > "$FAKE/conversations.history.json"
run_doctor; level 6 주의 "channel history missing_scope → 주의 (own wording: 매니페스트 권한 부족)" "매니페스트 권한 부족" "앱 권한에 channels:history 가 없습니다" "재설치"
branch_only "missing_scope names no branch" "매니페스트 권한 부족" "① 다른 워크스페이스" "② 관리자 승인 대기" "③ "
run_doctor --strict; [ "$RC" = 1 ] && ok "warning only → --strict rc 1" || bad "warning only --strict rc $RC"
slack_ok; printf '{"ok": false, "error": "is_archived"}\n' > "$FAKE/conversations.history.json"
run_doctor; level 6 주의 "archived channel → 주의" "is_archived"
# the manifest has no channels:read: an info answer that says channel_not_found must change nothing
slack_ok; printf '{"ok": false, "error": "channel_not_found"}\n' > "$FAKE/conversations.info.json"
run_doctor; level 6 OK "conversations.info answers are ignored (history decides)" "alpha 정상"
# K22 (10-25 · WSL test machine): the bridge reads SLACK_CHANNEL_ID as a comma list — blanks/spaces dropped, first = the
# primary channel, «*» = every channel the bot is in (never first · bridge config.ts parseChannelIds). A list is not a placeholder.
slack_ok; mkroot alpha; mkbot alpha "$BT1" "$AT1" "$CH,CTEST000002" "$T/work/alpha"
run_doctor; level 6 OK "K22 «C1,C2» → the first id is checked (not «비었거나 자리표시자»)" "alpha 정상"
slack_ok; mkroot alpha; mkbot alpha "$BT1" "$AT1" "$CH, *," "$T/work/alpha"
run_doctor; level 6 OK "K22 «C1, *,» (wildcard after the first · space · trailing comma) → OK" "alpha 정상"
slack_ok; mkroot alpha; mkbot alpha "$BT1" "$AT1" "*,$CH" "$T/work/alpha"
run_doctor; level 6 주의 "K22 «*» first → 주의 (the bridge refuses it too)" "채널 ID 가 없거나 자리표시자"

# ── 3. auth.test failure, no network ─────────────────────────────────────────────────────────────────────────────────
slack_ok; mkroot alpha
printf '{"ok": false, "error": "invalid_auth"}\n' > "$FAKE/auth.test.json"
run_doctor; summary_ok "auth failure"
level 5 실패 "auth.test invalid_auth → 실패" "invalid_auth" "slackmod set-token alpha"
level 6 실패 "… and the invite cell says ② (auth.test invalid_auth)" "② 관리자 승인 대기 꼴" "토큰을 다시 받으세요"
slack_ok; FAKEDIR="$T/nothing-here" run_doctor
level 5 주의 "no answer at all (network) → 주의" "닿지 못함"
unset FAKEDIR

# ── 4. skip semantics ────────────────────────────────────────────────────────────────────────────────────────────────
rm -rf "$T/empty-root"; mkdir -p "$T/empty-root"
ROOTSAVE="$ROOTD"; ROOTD="$T/empty-root"
run_doctor; summary_ok "not installed"; nolines "not installed"
level 3 건너뜀 "not installed [3] → 건너뜀" "설치가 안 보여"
level 4 건너뜀 "not installed [4] → 건너뜀"
level 5 건너뜀 "not installed [5] → 건너뜀"
level 6 건너뜀 "not installed [6] → 건너뜀"
level 9 건너뜀 "not installed [9] → 건너뜀"
level 1 OK "not installed: window tool still checked"
run_doctor --strict; [ "$RC" = 2 ] && ok "not installed --strict: rc 2 (could not check)" || bad "not installed --strict rc $RC"
run_doctor; [ "$RC" = 0 ] && ok "not installed plain run: rc 0" || bad "not installed plain rc $RC"
ROOTD="$ROOTSAVE"
mkroot alpha; : > "$ROOTD/bots.list"
run_doctor; summary_ok "blank install (0 bots)"
level 3 건너뜀 "blank install [3] → 건너뜀 (봇이 0개)" "봇이 0개"
level 4 건너뜀 "blank install [4] → 건너뜀" "봇이 0개"
level 6 건너뜀 "blank install [6] → 건너뜀" "봇이 0개"
run_doctor --strict; [ "$RC" = 0 ] && ok "blank install --strict: rc 0 (only skips)" || bad "blank install --strict rc $RC"
mkroot alpha scout; mkbot scout "$BT2" "$AT1" "$CH" "$T/work/scout"
run_doctor; level 3 실패 "two bots with one app token → 실패" "같은 Slack 앱 토큰"
mkroot alpha; printf 'alpha\r\n' > "$ROOTD/bots.list"
run_doctor; summary_ok "bots.list with CR"
level 3 실패 "bots.list with CR → [3] 실패" "꼴이 깨짐"
level 4 건너뜀 "bots.list with CR → [4] 건너뜀 (one cause, one failure)" "[3] 칸 참고"
level 5 건너뜀 "bots.list with CR → [5] 건너뜀" "[3] 칸 참고"
level 6 건너뜀 "bots.list with CR → [6] 건너뜀" "[3] 칸 참고"
level 9 건너뜀 "bots.list with CR → [9] 건너뜀" "[3] 칸 참고"
mkroot alpha
printf '{"schema": 1, "slack": {"enabled": false}, "bots": [{"name": "alpha", "source": "role-default"}]}\n' > "$ROOTD/setup.json"
run_doctor; summary_ok "slack skipped by the wizard"
level 3 건너뜀 "slack off [3] → 건너뜀" "Slack 연결을 건너뛰기"
level 5 건너뜀 "slack off [5] → 건너뜀" "Slack 연결을 건너뛰기"
level 6 건너뜀 "slack off [6] → 건너뜀" "Slack 연결을 건너뛰기"
level 9 건너뜀 "slack off [9] → 건너뜀" "Slack 연결을 건너뛰기"
level 4 OK "slack off: persona check still runs" "alpha 통과"

# ── 5. persona cell ──────────────────────────────────────────────────────────────────────────────────────────────────
mkroot alpha; cp "$REPO/setup/templates/roles/lead/persona.md" "$T/work/alpha/persona.md"
run_doctor
level 4 주의 "raw skeleton in the bot folder → 주의" "alpha 걸림" "자리표시자"
cellhas 4 "다시 묻고 채우기" && ok "persona fix line is the check's own" || bad "persona fix line"
mkroot alpha; printf '\n메모: %s\n' "$BT1" >> "$T/work/alpha/persona.md"
run_doctor
level 4 실패 "token-shaped text in persona → 실패" "비밀값"
mkroot alpha; rm -rf "$T/work/alpha"
run_doctor; level 4 주의 "no persona folder → 주의" "성격 폴더가 없음"
mkroot alpha; mv "$T/work/alpha/persona.md" "$T/work/alpha/other.md"
printf '{"schema": 1, "bots": [{"name": "alpha", "source": "import", "persona_dir": "%s/work/alpha"}]}\n' "$T" > "$ROOTD/setup.json"
run_doctor; level 4 OK "imported bot: layout (required) not demanded" "alpha 통과"
mkroot alpha
DENV="SLACKMOD_PERSONA_CHECK=$T/no-such.py" run_doctor; level 4 건너뜀 "persona-check.py missing → 건너뜀" "persona-check.py 가 안 보임"

# ── 6. login cell ────────────────────────────────────────────────────────────────────────────────────────────────────
mkroot alpha
printf '{"loggedIn": false}\n' > "$T/claude-status.json"
run_doctor; level 2 실패 "not logged in → 실패" "/login"
printf '{"loggedIn": true, "authMethod": "api_key", "apiKeySource": "ANTHROPIC_API_KEY"}\n' > "$T/claude-status.json"
run_doctor; level 2 주의 "api key login → 주의" "API 키"
printf 'not json\n' > "$T/claude-status.json"
run_doctor; level 2 주의 "unreadable status → 주의" "읽지 못함"
cp "$T/claude-ok.json" "$T/claude-status.json"
DENV="ANTHROPIC_API_KEY=placeholder-not-a-key" run_doctor; level 2 주의 "API key in the environment → 주의" "API 키"
mkbin "$T/bin-noclaude" tmux launchctl
printf "SM_WORK_DIR='%s/work/alpha'\nSM_CLAUDE='%s/no-such-claude'\n" "$T" "$T" > "$ROOTD/bots/alpha/launch.sh"
PATHDIR="$T/bin-noclaude" run_doctor; level 2 실패 "claude binary missing → 실패" "Claude Code 가 없음"
unset PATHDIR

# ── 7. window tool cell ──────────────────────────────────────────────────────────────────────────────────────────────
mkbin "$T/bin-herdr" herdr claude launchctl
PATHDIR="$T/bin-herdr" run_doctor; level 1 주의 "herdr only → 주의" "herdr"
mkbin "$T/bin-none" claude launchctl
PATHDIR="$T/bin-none" run_doctor; level 1 실패 "no window tool → 실패" "tmux 가 없음"
PATHDIR="$T/bin-none" run_doctor --strict; [ "$RC" = 1 ] && ok "no window tool --strict: rc 1" || bad "no window tool --strict rc $RC"
DENV="ORCA_TERMINAL_HANDLE=h1" run_doctor; level 1 주의 "Orca env → 주의 + guidance" "Orca" "SUPPORT.md"
DENV="TMUX=/tmp/orca-claude-agent-teams/sock,1,0" run_doctor; level 1 주의 "tmux socket from Orca → 주의" "Orca"
PATHDIR="$T/bin-herdr" DENV="ORCA_TERMINAL_HANDLE=h1" run_doctor; level 1 주의 "Orca wins over a visible tool" "Orca"
unset PATHDIR

# ── 8. bots cell ─────────────────────────────────────────────────────────────────────────────────────────────────────
mkroot alpha; rm -f "$FAKETMUX/windows-alpha"; printf 'alpha 꺼짐 없음 set·set 0\n' > "$T/st.tmp"; { printf '봇 켜짐 다리 토큰 하위창\n'; cat "$T/st.tmp"; } > "$ROOTD/status.txt"
run_doctor; level 9 주의 "bot off → 주의" "alpha 꺼짐" "slackmod start alpha"
mkroot alpha; printf 'bridge\n' > "$FAKETMUX/windows-alpha"
run_doctor; level 9 실패 "main window missing → 실패" "main 창 없음"
mkroot alpha; { printf '봇 켜짐 다리 토큰 하위창\n'; printf 'alpha 켜짐 없음 set·set 0\n'; } > "$ROOTD/status.txt"
run_doctor; level 9 실패 "bridge connection file missing → 실패" "다리 연결 파일 없음"
mkroot alpha; : > "$T/ps.txt"; printf '  501  1  0 /sbin/launchd\n' > "$T/ps.txt"
run_doctor; level 9 실패 "bridge window with no bridge process → 실패" "다리 프로그램이 안 돎"
mkroot alpha; printf '[2026-10-24T09:00:00.000Z] [server] failed to start Slack bridge: An API error occurred: invalid_auth\n' > "$ROOTD/bots/alpha/slack/server.log"
run_doctor; level 9 실패 "last connection line = invalid_auth → 실패" "invalid_auth" "slackmod set-token alpha"
mkroot alpha; printf '[2026-10-24T09:00:00.000Z] [slack] socket reconnecting\n' > "$ROOTD/bots/alpha/slack/server.log"
run_doctor; level 9 주의 "socket reconnecting → 주의" "socket reconnecting"
# K19: a fresh Claude Code waits on a first-start screen in the bot window (status = 켜짐 · bridge connected · but it never answers)
# screen text as captured from a real Claude Code 2.1.309 (probe 2026-10-25): trust/bypass options unnumbered · dev-channels numbered
mkroot alpha; printf 'Do you trust the files in this folder?\n❯ No, exit\n  Yes, I trust this folder\nEnter to confirm · Esc to cancel\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 9 실패 "bot window parked at folder trust → 실패" "alpha 봇 창이 처음 켜기 확인(폴더 신뢰)에서 기다림" "slackmod attach alpha → 아래 화살표로 «Yes» → Enter"
mkroot alpha; printf 'WARNING: Claude Code running in Bypass Permissions mode\n❯ No, exit\n  Yes, I accept\nEnter to confirm · Esc to cancel\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 9 실패 "bot window parked at bypass warning → 실패" "(권한 건너뛰기 경고)"
mkroot alpha; printf -- '--dangerously-load-development-channels is for local channel development only.\n❯ 1. I am using this for local development\n  2. Exit\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 9 실패 "bot window parked at dev-channels confirm → 실패" "(개발 채널 확인)" "slackmod attach alpha → «1» 고른 채 Enter"
level 12 OK "dev-channels confirm screen is not a channel-off trace → [12] OK"
# K19b: a project .mcp.json server the kit did not pre-approve (as captured in G2 run 1, 2026-10-25)
mkroot alpha; printf '  New MCP server found in this project: playwright\n    Use this MCP server\n    Use this and all future MCP servers in this project\n  ❯ Continue without using this MCP server\n  Enter to confirm · Esc to cancel\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 9 실패 "bot window parked at «New MCP server found» → 실패" "(MCP 서버 승인)" "slackmod attach alpha → 위 화살표로 «Use this MCP server» → Enter"
mkroot alpha; printf '❯ Try "fix lint errors"\n⏵⏵ bypass permissions on (shift+tab to cycle)\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 9 OK "ready bot window → [9] OK (no first-start words)" "alpha 켜짐 bridge·main 창 있음"
mkbin "$T/bin-notmux" claude launchctl
mkroot alpha; PATHDIR="$T/bin-notmux" run_doctor; level 9 건너뜀 "no window tool → [9] 건너뜀" "[1] 칸"
unset PATHDIR

# ── 9. outside bridge · old hooks ────────────────────────────────────────────────────────────────────────────────────
mkroot alpha; printf '  501  7001  1 node /srv/other/claude-channel-server/dist/server.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "bridge started outside the install → 실패" "설치 밖에서 켠 Slack 다리 1개"
run_doctor --strict; [ "$RC" = 1 ] && ok "outside bridge --strict: rc 1" || bad "outside bridge --strict rc $RC"
# sec ⑪ (independent review 10-25): a relay = «dist/mcp.js» with NOTHING after it (Claude starts it from mcp.json with no
# arguments). The real server code under that file name — a row with anything after mcp.js — is a bridge, same rule as the
# slackmod start gate (m25-bridge-columns.sh ⑩k). Residual: a process that omits the arguments passes as a relay.
mkroot alpha; printf '  501  7003  1 node /outside/claude-channel-server/dist/mcp.js --socket-mode\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ «…/claude-channel-server/dist/mcp.js --socket-mode» → a bridge (실패), not the relay warning" "설치 밖에서 켠 Slack 다리 1개"
cellhas 7 "중계 부품" && bad "⑪ disguised row also labelled as a relay part" || ok "⑪ disguised row not labelled as a relay part"
mkroot alpha; printf '  501  7004  1 node /outside/channel-server/dist/mcp.js --x\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ «…/channel-server/dist/mcp.js --x» (no «claude-» in the path) → a bridge" "설치 밖에서 켠 Slack 다리 1개"
mkroot alpha; printf '  501  7005  1 node /outside/claude-channel-server/dist/server.js /outside/claude-channel-server/dist/mcp.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ server.js with an «dist/mcp.js» argument → a bridge (the relay word cannot hide it)" "설치 밖에서 켠 Slack 다리 1개"
# sec ⑪ round 2 (re-review 10-26): the line END is not the rule — «…/dist/mcp.js --socket-mode dist/mcp.js» ends in mcp.js but the
# script (first «dist/…js» word) has arguments after it → a bridge. A relay = that script word is dist/mcp.js and nothing follows it.
mkroot alpha; printf '  501  7008  1 node /outside/claude-channel-server/dist/mcp.js --socket-mode dist/mcp.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ r2 «…/dist/mcp.js --socket-mode dist/mcp.js» (ends in mcp.js again) → a bridge, not the relay warning" "설치 밖에서 켠 Slack 다리 1개"
# sec ⑪ round 3 (security review 10-26): only the exact «<node> …/dist/mcp.js» is a relay and only «<node> $ROOT/app/channel-server/
# dist/{server,mcp}.js» is ours — a wrapper, «node -e», node flags first, or an extra word naming our app folder = a bridge
mkroot alpha; printf '  501  7009  1 /bin/sh /tmp/wrap.sh /outside/claude-channel-server/dist/mcp.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ r3 wrapper script + trailing …/dist/mcp.js → a bridge, not the relay warning" "설치 밖에서 켠 Slack 다리 1개"
mkroot alpha; printf '  501  7010  1 node -e require(/outside/channel-server/dist/server.js) /outside/claude-channel-server/dist/mcp.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ r3 «node -e require(…server.js) …/dist/mcp.js» → a bridge" "설치 밖에서 켠 Slack 다리 1개"
mkroot alpha; printf '  501  7011  1 node dist/server.js %s/app/channel-server\n' "$ROOTD" >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ r3 relative server.js + one word naming OUR app folder → a bridge (not ours)" "설치 밖에서 켠 Slack 다리 1개"
mkroot alpha; printf '  501  7012  1 node --enable-source-maps /home/u/.claude/plugins/claude-channel-server/dist/mcp.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ r3 node flags before the script → a bridge (exact shape only)" "설치 밖에서 켠 Slack 다리 1개"
# controls (must not regress): a genuine no-argument relay is still only the old-window warning, and a bridge next to it is still counted once
mkroot alpha; printf '  501  7006  1 node /home/u/.claude/plugins/claude-channel-server/dist/mcp.js\n' >> "$T/ps.txt"
run_doctor; level 7 주의 "⑪ control: no-argument «…/dist/mcp.js» → still the relay warning (주의, not 실패)" "중계 부품 mcp.js 1개" "다리 본체는 없음"
mkroot alpha; printf '  501  7006  1 node /home/u/.claude/plugins/claude-channel-server/dist/mcp.js\n  501  7007  1 node /srv/other/claude-channel-server/dist/server.js\n' >> "$T/ps.txt"
run_doctor; level 7 실패 "⑪ control: relay + one real bridge → the bridge counted once, relay not added" "설치 밖에서 켠 Slack 다리 1개"
mkroot alpha; mkdir -p "$HOMED/.claude"
printf '{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/lib/bot-only.sh"}]}]}}\n' > "$HOMED/.claude/settings.json"
run_doctor; level 8 실패 "old hook line pointing nowhere → 실패" "bot-only"
mkroot alpha; mkdir -p "$HOMED/.claude"; printf '#!/bin/sh\n' > "$T/bot-only.sh"
printf '{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "%s"}]}]}}\n' "$T/bot-only.sh" > "$HOMED/.claude/settings.json"
run_doctor; level 8 주의 "old hook line whose file still exists → 주의 (not 실패)" "파일은 있음"
mkroot alpha; mkdir -p "$HOMED/.claude"; printf '{ broken json\n' > "$HOMED/.claude/settings.json"
run_doctor; level 8 주의 "settings.json broken → 주의" "JSON 이 깨져"
# K24 (WSL test machine, 10-25): an official channel plugin switched on for the whole account also starts inside every
# bot (the kit's bot launch does not isolate plugins) — the Telegram one takes over the token's poller on start, so the
# person's existing channel bot can drop. The folder's own settings win over the account's (measured: folder false beats
# account true). [8] names the bot and the plugin, and says how to switch it off for that bot only.
mkroot alpha scout; mkdir -p "$HOMED/.claude"
printf '{"enabledPlugins": {"telegram@claude-plugins-official": true}}\n' > "$HOMED/.claude/settings.json"
run_doctor; level 8 주의 "K24 account-wide telegram plugin → [8] 주의 for each bot" "다른 채널 플러그인" "alpha: telegram" "scout: telegram" ".claude/settings.local.json" '"telegram@claude-plugins-official": false'
summary_ok "K24 account-wide telegram"
mkdir -p "$T/work/alpha/.claude"; printf '{"enabledPlugins": {"telegram@claude-plugins-official": false}}\n' > "$T/work/alpha/.claude/settings.local.json"
run_doctor; level 8 주의 "K24 alpha folder switches it off → only scout named" "scout: telegram"
cellhas 8 "alpha: telegram" && bad "K24 alpha folder off still named" || ok "K24 alpha folder off → alpha not named"
mkdir -p "$T/work/scout/.claude"; printf '{"enabledPlugins": {"telegram@claude-plugins-official": false}}\n' > "$T/work/scout/.claude/settings.json"
run_doctor; level 8 OK "K24 both folders off (local · project) → [8] OK"
mkroot alpha; mkdir -p "$T/work/alpha/.claude"
printf '{"enabledPlugins": {"discord@claude-plugins-official": true, "telegram@someone-else": true}}\n' > "$T/work/alpha/.claude/settings.json"
run_doctor; level 8 주의 "K24 discord on in the bot folder → named" "alpha: discord"
cellhas 8 "telegram" && bad "K24 a non-official telegram fork named" || ok "K24 a non-official «telegram@someone-else» not named"
mkroot alpha; mkdir -p "$HOMED/.claude"
printf '{"enabledPlugins": {"discord@claude-plugins-official": true}}\n' > "$HOMED/.claude/settings.json"
mkdir -p "$T/work/alpha/.claude"; printf '{"enabledPlugins": {"discord@claude-plugins-official": false}}\n' > "$T/work/alpha/.claude/settings.json"
printf '{"enabledPlugins": {"discord@claude-plugins-official": true}}\n' > "$T/work/alpha/.claude/settings.local.json"
run_doctor; level 8 주의 "K24 folder local on beats folder project off → named" "alpha: discord"
# K24a′ (WSL test machine, 10-25 09:1x): a bot that loads telegram/discord on purpose (config bots[].extra_channels →
# launch.sh SM_EXTRA_CHANNELS «plugin:telegram@claude-plugins-official») must not be told to switch its own channel off.
# And the fix line must not promise «only that bot»: the bot folder's settings are read by every window opened there.
mkroot alpha scout; mkdir -p "$HOMED/.claude"
printf '{"enabledPlugins": {"telegram@claude-plugins-official": true, "discord@claude-plugins-official": true}}\n' > "$HOMED/.claude/settings.json"
printf "SM_EXTRA_CHANNELS='plugin:telegram@claude-plugins-official plugin:discord@claude-plugins-official'\n" >> "$ROOTD/bots/alpha/launch.sh"
run_doctor; level 8 주의 "K24a′ alpha loads both on purpose → only scout named" "scout: telegram" "scout: discord"
cellhas 8 "alpha:" && bad "K24a′ intended channels still named for alpha" || ok "K24a′ alpha's own extra_channels not named"
cellhas 8 "그 봇에서만" && bad "K24a′ fix line still promises «only that bot»" || ok "K24a′ fix line does not promise «only that bot»"
level 8 주의 "K24a′ fix line says every window opened in that folder" "그 폴더에서 여는 Claude 창 모두" "extra_channels"
mkroot alpha; mkdir -p "$HOMED/.claude"
printf '{"enabledPlugins": {"telegram@claude-plugins-official": true, "discord@claude-plugins-official": true}}\n' > "$HOMED/.claude/settings.json"
printf "SM_EXTRA_CHANNELS='plugin:telegram@claude-plugins-official'\n" >> "$ROOTD/bots/alpha/launch.sh"
run_doctor; level 8 주의 "K24a′ only telegram intended → discord still named" "alpha: discord"
cellhas 8 "alpha: telegram" && bad "K24a′ intended telegram named" || ok "K24a′ intended telegram not named"
mkroot alpha; mkdir -p "$HOMED/.claude"
printf '{"enabledPlugins": {"telegram@claude-plugins-official": true}}\n' > "$HOMED/.claude/settings.json"
printf "SM_EXTRA_CHANNELS='plugin:telegram@someone-else server:x'\n" >> "$ROOTD/bots/alpha/launch.sh"
run_doctor; level 8 주의 "K24a′ a different marketplace's telegram in extra_channels does not excuse the official one" "alpha: telegram"
# sec ⑬ (independent review 10-25): the doctor is read-only, so a bot's launch.sh is READ, never run. Before: launch_var sourced
# the file with «.» — a launch.sh swapped for a symlink to an outside file (or edited in place) ran its commands during the check.
# The marker files below are written only if a line of that file is executed. Values are still read as text (also through a symlink).
mkroot alpha; mkdir -p "$HOMED/.claude"
printf '{"enabledPlugins": {"telegram@claude-plugins-official": true}}\n' > "$HOMED/.claude/settings.json"
M13="$T/marker13"; rm -f "$M13"
printf "SM_WORK_DIR='%s/work/alpha'\nprintf xyz > '%s'\nSM_CLAUDE='%s/claude'\nSM_EXTRA_CHANNELS='plugin:telegram@claude-plugins-official'\n" "$T" "$M13" "$BIN" > "$T/outside-launch.sh"
rm -f "$ROOTD/bots/alpha/launch.sh"; ln -s "$T/outside-launch.sh" "$ROOTD/bots/alpha/launch.sh"
run_doctor; level 8 OK "⑬ launch.sh symlinked to an outside file: [8] still reads its values as text (extra_channels exempts alpha)"
[ -e "$M13" ] && bad "⑬ symlinked launch.sh: a command in it was executed (marker_bytes=$(wc -c < "$M13" | tr -d ' '))" || ok "⑬ symlinked launch.sh: nothing in it was executed (no marker)"
[ -L "$ROOTD/bots/alpha/launch.sh" ] && ok "⑬ the symlink itself is untouched (read-only)" || bad "⑬ the symlink was replaced"
# the same file edited in place: a chained command after a value · a command substitution inside a value · an export form
rm -f "$M13" "$M13.b" "$M13.c" "$ROOTD/bots/alpha/launch.sh"
printf "SM_WORK_DIR='%s/work/alpha'; printf xyz > '%s'\nexport SM_CLAUDE=\$(printf xyz > '%s.b')\nSM_EXTRA_CHANNELS=\`printf xyz > '%s.c'\`\n" "$T" "$M13" "$M13" "$M13" > "$ROOTD/bots/alpha/launch.sh"
run_doctor
[ -e "$M13" ] || [ -e "$M13.b" ] || [ -e "$M13.c" ] && bad "⑬ in-place edited launch.sh: a command was executed (chained=$([ -e "$M13" ] && echo 1 || echo 0) subst=$([ -e "$M13.b" ] && echo 1 || echo 0) backtick=$([ -e "$M13.c" ] && echo 1 || echo 0))" || ok "⑬ in-place edited launch.sh (chained · \$( ) · backticks): nothing executed"
# values the generator writes (shlex-quoted, spaces and an embedded quote) come back unchanged through the parser
rm -f "$ROOTD/bots/alpha/launch.sh"
printf "# generated\nSM_WORK_DIR='%s/work/alpha'\nexport SM_EXTRA_CHANNELS='plugin:telegram@claude-plugins-official server:x'\n" "$T" > "$ROOTD/bots/alpha/launch.sh"
run_doctor; level 8 OK "⑬ comment line + export form + quoted value with a space read as text: extra_channels still exempts alpha's telegram"
# a launch.sh whose extra_channels line is not a plain assignment is NOT trusted: the exemption does not apply (no guessing)
rm -f "$ROOTD/bots/alpha/launch.sh"
printf "SM_WORK_DIR='%s/work/alpha'\nSM_EXTRA_CHANNELS='plugin:telegram@claude-plugins-official'; true\n" "$T" > "$ROOTD/bots/alpha/launch.sh"
run_doctor; level 8 주의 "⑬ extra_channels line with a command chained after it is not read (no exemption) → alpha: telegram named" "alpha: telegram"

mkroot alpha; mkbin "$T/bin-lcfail" tmux claude; printf '#!/bin/sh\nexit 1\n' > "$T/bin-lcfail/launchctl"; chmod 755 "$T/bin-lcfail/launchctl"
PATHDIR="$T/bin-lcfail" run_doctor; level 11 주의 "launchctl list fails → 주의" "예약"
unset PATHDIR

# ── 9b. channel feature ([12] · «④ 채널 기능 꺼짐») ───────────────────────────────────────────────────────────────────
MG="$T/managed-bait"
mgfresh() { rm -rf "$MG"; mkdir -p "$MG/managed-settings.d"; }
# organisation switch: channelsEnabled=false in the managed settings
mkroot alpha; mgfresh; printf '{"channelsEnabled": false}\n' > "$MG/managed-settings.json"
MANAGED="$MG" run_doctor; summary_ok "channels off by organisation"
level 12 실패 "channelsEnabled=false → 실패" "④ 채널 기능 꺼짐" "조직 관리자가 채널을 꺼 둠" "managed-settings.json" "Owner 에게 채널을 켜 달라고"
MANAGED="$MG" run_doctor --strict; [ "$RC" = 1 ] && ok "channelsEnabled=false --strict: rc 1" || bad "channelsEnabled=false --strict rc $RC"
mgfresh; printf '{"channelsEnabled": true}\n' > "$MG/managed-settings.json"
MANAGED="$MG" run_doctor; level 12 OK "channelsEnabled=true → OK" "꺼질 만한 원인이 안 보임"
mgfresh; printf '{"model": "x"}\n' > "$MG/managed-settings.json"
MANAGED="$MG" run_doctor; level 12 OK "managed file without the key → OK"
mgfresh; printf '{"channelsEnabled": "false"}\n' > "$MG/managed-settings.json"
MANAGED="$MG" run_doctor; level 12 OK "string «false» is not the switch (only the JSON false) → OK"
for v in null 0 '""' '[]'; do
  mgfresh; printf '{"channelsEnabled": %s}\n' "$v" > "$MG/managed-settings.json"
  MANAGED="$MG" run_doctor; level 12 OK "channelsEnabled=$v is falsy but not the JSON false → OK"
done
mgfresh; printf '{"channelsEnabled": true}\n' > "$MG/managed-settings.json"; printf '{"channelsEnabled": false}\n' > "$MG/managed-settings.d/50-org.json"
MANAGED="$MG" run_doctor; level 12 실패 "drop-in file turns it off (.d/*.json) → 실패" "managed-settings.d/50-org.json"
mgfresh; printf '{"channelsEnabled": false}\n' > "$MG/managed-settings.json"; printf '{"channelsEnabled": true}\n' > "$MG/managed-settings.d/90-allow.json"
MANAGED="$MG" run_doctor; level 12 OK "a later drop-in turns it back on → OK (last file wins)"
mgfresh; printf '{ broken\n' > "$MG/managed-settings.json"
MANAGED="$MG" run_doctor; level 12 주의 "unreadable managed file → 주의" "관리 설정 파일을 못 읽음"
mgfresh; rm -rf "$MG/managed-settings.d"
MANAGED="$MG" run_doctor; level 12 OK "managed folder without drop-in folder → OK"
MANAGED="$T/no-such-managed-dir" run_doctor; level 12 OK "no managed folder at all → OK"
# login method: Bedrock / Vertex / Foundry variable names (values never shown)
for nm in CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY; do
  mkroot alpha; DENV="$nm=1" run_doctor
  level 12 실패 "$nm in the environment → 실패" "④ 채널 기능 꺼짐" "이 로그인 방식에선 채널이 안 됨" "$nm(환경 변수)"
done
# relay login: names only, value never printed
mkroot alpha; DENV="ANTHROPIC_AUTH_TOKEN=relay-value-bait-4321" run_doctor
level 12 주의 "ANTHROPIC_AUTH_TOKEN → 주의" "중계·대리 로그인이면 채널이 꺼질 수 있음" "ANTHROPIC_AUTH_TOKEN(환경 변수)" "claude.ai 로그인 권장"
has "relay-value-bait-4321" && bad "relay token value reached the output" || ok "relay token value absent from output"
mkroot alpha; DENV="ANTHROPIC_BASE_URL=https://relay-bait.example.org/v1" run_doctor
level 12 주의 "ANTHROPIC_BASE_URL → 주의" "ANTHROPIC_BASE_URL(환경 변수)"
has "relay-bait.example.org" && bad "relay address reached the output" || ok "relay address absent from output"
DENV="ANTHROPIC_BASE_URL=https://relay-bait.example.org/v1" run_doctor --strict; [ "$RC" = 1 ] && ok "relay warning --strict: rc 1" || bad "relay warning --strict rc $RC"
mkroot alpha; DENV="ANTHROPIC_BASE_URL= ANTHROPIC_AUTH_TOKEN=" run_doctor; level 12 OK "variables present but empty → OK"
# the window tool's global environment (what a bot window inherits)
mkroot alpha; printf 'CLAUDE_CODE_USE_VERTEX=1\n-SOMETHING_REMOVED\n' > "$FAKETMUX/globalenv"
run_doctor; level 12 실패 "global environment of the window tool: Vertex → 실패" "CLAUDE_CODE_USE_VERTEX(창 도구 전역 환경)"
mkroot alpha; printf 'ANTHROPIC_AUTH_TOKEN=relay-value-bait-8765\n' > "$FAKETMUX/globalenv"
run_doctor; level 12 주의 "global environment of the window tool: relay token → 주의" "ANTHROPIC_AUTH_TOKEN(창 도구 전역 환경)"
has "relay-value-bait-8765" && bad "global-environment value reached the output" || ok "global-environment value absent from output"
# settings files' env blocks
mkroot alpha; mkdir -p "$HOMED/.claude"; printf '{"env": {"CLAUDE_CODE_USE_FOUNDRY": "1", "OTHER": "x"}}\n' > "$HOMED/.claude/settings.json"
run_doctor; level 12 실패 "user settings env block: Foundry → 실패" "CLAUDE_CODE_USE_FOUNDRY(설정 파일 env)"
mkroot alpha; printf '{"env": {"ANTHROPIC_BASE_URL": "https://relay-bait.example.org"}}\n' > "$T/work/alpha/.claude.tmp"; mkdir -p "$T/work/alpha/.claude"; mv "$T/work/alpha/.claude.tmp" "$T/work/alpha/.claude/settings.local.json"
run_doctor; level 12 주의 "bot folder settings env block: relay address → 주의" "ANTHROPIC_BASE_URL(설정 파일 env)"
has "relay-bait.example.org" && bad "settings env value reached the output" || ok "settings env value absent from output"
mkroot alpha; mkdir -p "$HOMED/.claude"; printf '{"env": {"HARMLESS": "1"}}\n' > "$HOMED/.claude/settings.json"
run_doctor; level 12 OK "settings env block with other names only → OK"
# traces of the message itself
mkroot alpha; printf '[2026-10-24T09:00:00.000Z] [server] note: --dangerously-load-development-channels ignored · Channels are not currently available\n' >> "$ROOTD/bots/alpha/slack/server.log"
run_doctor; level 12 실패 "message in the bridge log → 실패" "«Channels are not currently available»" "«development-channels ignored» 가 찍혀 있음" "alpha 의 다리 기록"
mkroot alpha; printf 'welcome\n--dangerously-load-development-channels ignored\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 12 실패 "«development-channels ignored» alone on the screen → 실패" "development-channels ignored" "alpha 의 봇 화면"
mkroot alpha; printf '[2026-10-24T09:00:00.000Z] [server] --dangerously-load-development-channels ignored\n' >> "$ROOTD/bots/alpha/slack/server.log"
run_doctor; level 12 실패 "«development-channels ignored» alone in the bridge log → 실패" "alpha 의 다리 기록"
# the normal start screen of a working bot (seen on live bots): none of these lines means «off»
mkroot alpha; printf '%s\n' 'Listening for channel messages from: server:slack-channel' 'server:slack-channel · no MCP server configured with that name' \
  'this session · restart without --dangerously-load-development-channels to stop' > "$FAKETMUX/pane-alpha"
printf '[2026-10-24T09:00:01.000Z] [slack] socket connected\n[2026-10-24T09:00:09.000Z] [server] delivered message to session: channel=C0TEST ts=1.2\n' >> "$ROOTD/bots/alpha/slack/server.log"
run_doctor; level 12 OK "normal start screen («no MCP server configured with that name») + delivered message → OK" "꺼질 만한 원인이 안 보임" "no MCP server configured with that name"
level 9 OK "… and the bot cell is OK too" "socket connected"
mkroot alpha; printf 'channels are NOT currently available\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 12 실패 "message on the bot screen (any letter case) → 실패" "alpha 의 봇 화면"
mkroot alpha scout; printf 'Channels are not currently available\n' > "$FAKETMUX/pane-scout"
run_doctor; level 12 실패 "only the second bot shows it → names that bot" "scout 의 봇 화면"
has "alpha 의 봇 화면" && bad "healthy bot named in the trace list" || ok "healthy bot not named"
mkroot alpha; printf 'ordinary screen text\n' > "$FAKETMUX/pane-alpha"
run_doctor; level 12 OK "ordinary screen text → OK"
# several causes at once: all named, worst level wins, one cell
mkroot alpha; mgfresh; printf '{"channelsEnabled": false}\n' > "$MG/managed-settings.json"
MANAGED="$MG" DENV="CLAUDE_CODE_USE_BEDROCK=1 ANTHROPIC_BASE_URL=https://relay-bait.example.org" run_doctor; summary_ok "channels: three causes"
level 12 실패 "organisation + Bedrock + relay → one 실패 cell naming all three" "조직 관리자가 채널을 꺼 둠" "이 로그인 방식에선 채널이 안 됨" "중계·대리 로그인"
# skips
printf '{"schema": 1, "slack": {"enabled": false}, "bots": [{"name": "alpha", "source": "role-default"}]}\n' > "$ROOTD/setup.json"
MANAGED="$MG" run_doctor; level 12 건너뜀 "slack off → [12] 건너뜀" "Slack 연결을 건너뛰기"
ROOTSAVE="$ROOTD"; ROOTD="$T/empty-root"; run_doctor; level 12 건너뜀 "not installed → [12] 건너뜀" "설치가 안 보여"; ROOTD="$ROOTSAVE"
mkroot alpha; : > "$ROOTD/bots.list"; run_doctor; level 12 건너뜀 "zero bots → [12] 건너뜀" "봇이 0개"
# the bait names must not look like an invite branch
mkroot alpha; MANAGED="$MG" run_doctor
l="$(cellline 12)"; case "$l" in *"① 다른 워크스페이스"*|*"② 관리자 승인 대기"*|*"③ 손님 계정"*) bad "channel cell borrowed an invite-branch mark" ;; *) ok "channel cell uses its own mark (④), not ①②③" ;; esac

# ── 9c. UTF-8 locale: bash 3.2 reads the first byte of a multibyte character that follows a bare dollar-name as part of the name ──
# static: no bare $name directly before a non-ASCII byte in any script of this lane (bait first, then the real files)
bare_var_hits() { LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^[:print:][:space:]]' "$@" 2>/dev/null | wc -l | tr -d ' '; }
printf 'x="$bt\xc2\xb7$at"\n' > "$T/bare-bait.sh"      # the middle dot, written as bytes so this file holds no such pattern itself
[ "$(bare_var_hits "$T/bare-bait.sh")" = 1 ] && ok "static check catches the bare-\$name bait (RED)" || bad "static check misses the bare-\$name bait"
printf 'x="${bt}\xc2\xb7${at}"\n' > "$T/bare-ok.sh"
[ "$(bare_var_hits "$T/bare-ok.sh")" = 0 ] && ok "static check leaves a braced name alone" || bad "static check flags a braced name"
n="$(bare_var_hits "$REPO/setup/lib/doctor.sh" "$REPO/setup/lib/persona-fill.py" "$REPO/setup/lib/persona-check.py" "$REPO/setup/tests/doctor-test.sh" "$REPO/setup/tests/persona-test.sh" "$REPO/setup/tests/mutate.sh" "$REPO/setup/tests/run-all.sh")"
[ "$n" = 0 ] && ok "static: no bare \$name before a non-ASCII character in this lane's scripts" || { bad "static: $n bare \$name before a non-ASCII character"; LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^[:print:][:space:]]' "$REPO/setup/lib/doctor.sh" "$REPO/setup/tests/doctor-test.sh" | head -5; }
# dynamic: the same runs under a UTF-8 locale give the same cells as under the C locale (one bot installed: the shape that crashed)
UTF8="LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8"
mkroot alpha
DENV="LANG=C LC_ALL=C" run_doctor; c_out="$OUT"; c_rc=$RC
DENV="$UTF8" run_doctor; u_out="$OUT"; u_rc=$RC
[ "$u_rc" = 0 ] && ok "UTF-8 locale, 1 bot, healthy: rc 0" || bad "UTF-8 locale healthy rc $u_rc"
summary_ok "UTF-8 locale, 1 bot, healthy"
level 3 OK "UTF-8 locale [3] tokens" "alpha set·set"
cut_time() { grep -v '^상태 점검 · ' <<<"$1"; }
[ "$(cut_time "$c_out")" = "$(cut_time "$u_out")" ] && ok "UTF-8 and C locale give the same lines (healthy, 1 bot)" || bad "UTF-8 and C locale differ (healthy, 1 bot)"
grep -q 'unbound variable\|bad substitution' <<<"$u_out" && bad "shell error text in the UTF-8 output" || ok "no shell error text in the UTF-8 output"
for ec in invalid_auth ratelimited; do
  mkroot alpha; printf '{"ok": false, "error": "%s"}\n' "$ec" > "$FAKE/auth.test.json"
  DENV="LANG=C LC_ALL=C" run_doctor; c_out="$OUT"
  DENV="$UTF8" run_doctor; u_out="$OUT"
  level 5 실패 "UTF-8 locale [5] auth.test ${ec}" "«${ec}»"
  [ "$(cut_time "$c_out")" = "$(cut_time "$u_out")" ] && ok "UTF-8 and C locale give the same lines (auth.test ${ec})" || bad "UTF-8 and C locale differ (auth.test ${ec})"
done
mkroot alpha; mkbot alpha "xo""xb-REPLACE-ME" "$AT1" "$CH" "$T/work/alpha"
DENV="$UTF8" run_doctor; level 3 실패 "UTF-8 locale [3] missing token" "alpha missing·set"

# ── 10. token never printed (inputs full of token shapes) ────────────────────────────────────────────────────────────
mkroot alpha scout
mkdir -p "$HOMED/.claude"
LEAK1="xo""xb-9999999999-LEAKLEAKLEAK"; LEAK2="gh""p_abcdefghijklmnopqrstuvwxyz0123"; LEAK3="sk-""ant-api03-leakleakleakleak"; LEAK4="AK""IAABCDEFGHIJKLMNOP"
LEAK5="xa""pp-1-A0123456789-leakleakleakleak"; LEAK6="github""_pat_abcdefghijklmnopqrstuvwxyz0123"
printf '{"enabledPlugins": {"thiscode@%s": true, "thiscode@%s": true, "thiscode@%s": true, "thiscode@%s": true, "thiscode@%s": true, "thiscode@%s": true}}\n' "$LEAK1" "$LEAK2" "$LEAK3" "$LEAK4" "$LEAK5" "$LEAK6" > "$HOMED/.claude/settings.json"
printf '[2026-10-24T09:00:00.000Z] [server] failed to start Slack bridge: An API error occurred: %s\n' "$LEAK1" > "$ROOTD/bots/alpha/slack/server.log"
printf '{"ok": false, "error": "%s"}\n' "$LEAK1" > "$FAKE/auth.test.json"
printf '  501  7002  1 node /srv/x/%s/claude-channel-server/dist/server.js\n' "$LEAK2" >> "$T/ps.txt"
run_doctor --strict
summary_ok "leak bait"
for L in "$LEAK1" "$LEAK2" "$LEAK3" "$LEAK4" "$LEAK5" "$LEAK6" "$BT1" "$AT1" "$BT2" "$AT2"; do
  has "$L" && bad "token-shaped text reached the output ($(printf '%s' "$L" | cut -c1-6)…)" || ok "token-shaped text absent from output ($(printf '%s' "$L" | cut -c1-6)…)"
done
has 'xox?-(가림)' && ok "last guard masked the plugin-name bait" || bad "last guard did not mask xox bait"
has 'gh?_(가림)' && ok "last guard masked the ghp_ bait" || bad "last guard did not mask ghp_ bait"
has 'AKIA(가림)' && ok "last guard masked the AKIA bait" || bad "last guard did not mask AKIA bait"
has 'sk-ant-(가림)' && ok "last guard masked the sk-ant bait" || bad "last guard did not mask sk-ant bait"
has 'xapp-(가림)' && ok "last guard masked the xapp bait" || bad "last guard did not mask xapp bait"
has 'github_pat_(가림)' && ok "last guard masked the github_pat bait" || bad "last guard did not mask github_pat bait"
cellhas 5 "«unknown»" && ok "answer text that is not a plain error word is reduced to «unknown»" || bad "answer text handling"

# ── 11. the real HTTP path against a local stand-in (no Slack, no real token) ────────────────────────────────────────
mkroot alpha
printf 'ok\n%s\n' "$BT1" > "$T/mode"
"$PY" -I "$REPO/setup/tests/fake-slack-server.py" "$T/port" "$T/http.log" "$T/mode" &
SRV_PID=$!
i=0; while [ ! -s "$T/port" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
if [ -s "$T/port" ]; then
  API="http://127.0.0.1:$(cat "$T/port")"
  FAKEDIR="" DENV="SLACKMOD_DOCTOR_SLACK_API=$API" run_doctor
  level 5 OK "http path: auth.test through a real request" "auth.test 통과"
  level 6 OK "http path: conversations.history through a real request" "alpha 정상"
  [ "$(grep -c 'auth=ok' "$T/http.log")" = 2 ] && ok "http path: server saw the right bearer value on both calls" || { bad "http path: bearer check ($(cat "$T/http.log" | tr '\n' ';'))"; }
  [ "$(grep -c '^/conversations.history auth=ok limit1$' "$T/http.log")" = 1 ] && ok "http path: history asked for exactly one message (limit=1)" || bad "http path: history limit ($(cat "$T/http.log" | tr '\n' ';'))"
  printf 'channel_not_found\n%s\n' "$BT1" > "$T/mode"
  FAKEDIR="" DENV="SLACKMOD_DOCTOR_SLACK_API=$API" run_doctor
  level 6 실패 "http path: channel_not_found → ①" "① 다른 워크스페이스"
  printf 'not_in_channel\n%s\n' "$BT1" > "$T/mode"
  FAKEDIR="" DENV="SLACKMOD_DOCTOR_SLACK_API=$API" run_doctor
  level 6 실패 "http path: not_in_channel → ③" "③ 손님 계정·채널 제한"
  printf 'missing_scope\n%s\n' "$BT1" > "$T/mode"
  FAKEDIR="" DENV="SLACKMOD_DOCTOR_SLACK_API=$API" run_doctor
  level 6 주의 "http path: missing_scope → 매니페스트 권한 부족" "매니페스트 권한 부족"
  [ "$(grep -c 'conversations.info' "$T/http.log")" = 0 ] && ok "http path: conversations.info is never called" || bad "http path: conversations.info was called"
  printf 'invalid_auth\n%s\n' "$BT1" > "$T/mode"
  FAKEDIR="" DENV="SLACKMOD_DOCTOR_SLACK_API=$API" run_doctor
  level 5 실패 "http path: invalid_auth → [5] 실패" "invalid_auth"
  level 6 실패 "http path: invalid_auth → ②" "② 관리자 승인 대기 꼴"
  # the token must not be in any process command line while the doctor runs: the probe takes bot names and file paths only
  has "$BT1" && bad "http path: token reached the output" || ok "http path: token absent from output"
else
  bad "http path: local server did not start"
fi
: > "$T/mode.stop"; sleep 1; kill "$SRV_PID" 2>/dev/null; SRV_PID=""

printf '\n합계: PASS %d · FAIL %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
