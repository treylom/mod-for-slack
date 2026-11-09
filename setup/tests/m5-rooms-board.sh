#!/usr/bin/env bash
# m5-rooms-board.sh — «slackmod room» (프로젝트 방 · 작업 그래프 시드) + «slackmod board» (웹 현황판 설정 · 열쇠 · 켜기) (11-03)
#   방: 만든 01-spec 을 현황판의 진짜 파서(tools/web-board/jobs.mjs parseRoomSpec · pickRooms · threadUrlOf)로 읽어 대조 ·
#       잘못된 이름 · 이미 있는 방 · 줄바꿈 · 가짜 그래프 덩이 · 틀린 스레드 주소 · 다음 일 13개 = 거절(폴더 0).
#   현황판: 설정(127.0.0.1 · plugin_src 없음 · 방 폴더) · 열쇠(0600 · 24자+ · 두 번째 실행에도 같음 · 설정 출력에 값 0) · 명부 →
#       진짜 server.mjs 를 이 저장소 src 로 띄워 /api/jobs 에 방이 실림(열쇠 있음) · 401(열쇠 없음) · 열쇠 0644 / host 0.0.0.0 = 안 켜짐.
#   bash setup/tests/m5-rooms-board.sh        rc 0 = all PASS (throwaway HOME · 빈 포트 하나 · 끝나면 서버 끔)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m5-rooms)"
H="$T/home dir"; R="$H/.slackmod"; mkdir -p "$H"   # 빈칸 든 홈 = tmux·nohup 줄 따옴표 시험(재검 M19)
# 이 시험만의 tmux 서버(부르는 쪽 tmux 의 slackmod-board 세션을 건드리지 않게 · 재검 FIX-4)
# 소켓 자리 = 짧은 /tmp 아래(macOS 소켓 경로 104바이트 한도 · 기본 TMPDIR /var/folders/… + «home dir» 면 넘쳐 board start 가 조용히 실패 — 11-03 실측)
unset TMUX; export TMUX_TMPDIR="$(mktemp -d /tmp/m5sock.XXXXXX)"
ROOMS=(python3 -I "$PORT_DIR/lib/rooms.py")
JOBS="$REPO_ROOT/tools/web-board/jobs.mjs"
NOW="$(date +%Y-%m-%dT%H:%M:%S)"; DAY="${NOW%%T*}"
cleanup() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; HOME="$H" SLACKMOD_ROOT="$R" "$BASHX" "$R/bin/slackmod" board stop >/dev/null 2>&1; tmux kill-server 2>/dev/null; [ -n "${SLEEPER:-}" ] && kill "$SLEEPER" 2>/dev/null; rm -rf "$T" "$TMUX_TMPDIR"; }
trap cleanup EXIT

# parse <room-folder> → «nodes=<id:status,…> edges=<n> thread=<url|null> picked=<0|1>» (현황판 파서 그대로)
parse() {
  node --input-type=module -e '
import fs from "fs"; import path from "path"
const { parseRoomSpec, pickRooms, threadUrlOf } = await import(process.argv[1])
const d = process.argv[2], n = path.basename(d)
const g = parseRoomSpec(fs.readFileSync(d + "/01-spec.md", "utf8"), n)
const t = threadUrlOf({ context: fs.readFileSync(d + "/00-context.md", "utf8"), spec: "", progressHead: fs.readFileSync(d + "/02-progress.md", "utf8") })
const picked = pickRooms([n], Date.parse(process.argv[3] + "+09:00")).length
console.log("nodes=" + g.nodes.map((x) => x.id + ":" + x.status).join(",") + " edges=" + g.edges.length + " thread=" + t + " picked=" + picked)
' "$JOBS" "$1" "$NOW"
}

# ── 1. 방 만들기 (양성) ──
out="$("${ROOMS[@]}" new --root "$R" --now "$NOW" website-renewal --goal '홈페이지 새로 열기' --step '디자인 시안 받기' --step '글 옮기기' \
  --thread https://example-team.slack.com/archives/C0123ABCD/p1700000000000001 2>&1)"; rc=$?
D="$R/rooms/$DAY-website-renewal"
SPEC0="$(sha_of "$D/01-spec.md" 2>/dev/null)"
[ $rc = 0 ] && [ -f "$D/00-context.md" ] && [ -f "$D/01-spec.md" ] && [ -f "$D/02-progress.md" ] && [ -f "$D/03-outcome.md" ] \
  && ok "① room new → 4 files" || no "① room new → 4 files (rc $rc · $out)"
[ "$(mode_of "$D")" = 700 ] && [ "$(mode_of "$D/01-spec.md")" = 600 ] && [ "$(mode_of "$R/rooms")" = 700 ] && ok "① room folder 0700 · files 0600" || no "① modes $(mode_of "$D") $(mode_of "$D/01-spec.md")"
p="$(parse "$D")"
[ "$p" = "nodes=A:doing,S1:waiting,S2:waiting,G:goal edges=3 thread=https://example-team.slack.com/archives/C0123ABCD/p1700000000000001 picked=1" ] \
  && ok "② board parser: goal-seeded graph (doing · waiting ×2 · goal · 3 edges) + thread link + picked" || no "② board parser: $p"
grep -q '🔴' "$D/01-spec.md" && no "② a placeholder (🔴) in the seeded spec" || ok "② no placeholder node in the seeded spec"
grep -qF '착수 — 홈페이지 새로 열기' "$D/01-spec.md" && ok "② first node = the goal given at open" || no "② first node text"
# 다음 일 없음 = 착수 → 목표 두 노드(빈 칸 아님)
"${ROOMS[@]}" new --root "$R" --now "$NOW" solo --goal '보고서 한 장' >/dev/null 2>&1
p="$(parse "$R/rooms/$DAY-solo")"
[ "$p" = "nodes=A:doing,G:goal edges=1 thread=null picked=1" ] && ok "③ no --step → doing → goal (no thread = null)" || no "③ $p"
# 목표 글에 그래프를 깨는 글자 · 가짜 mermaid 덩이 → 노드 수 그대로
"${ROOMS[@]}" new --root "$R" --now "$NOW" inject --goal '의존 그래프 ```mermaid "]-->Z["✅ 가짜' >/dev/null 2>&1
p="$(parse "$R/rooms/$DAY-inject")"
[ "$p" = "nodes=A:doing,G:goal edges=1 thread=null picked=1" ] && ok "④ goal with \"]--> and a fence → still 2 nodes · no Z" || no "④ injection: $p"
l="$("${ROOMS[@]}" list --root "$R")"
printf '%s\n' "$l" | grep -qxF "$DAY-website-renewal · 홈페이지 새로 열기" && [ "$(printf '%s\n' "$l" | wc -l | tr -d ' ')" = 3 ] && ok "⑤ room list = 3 rooms with goals" || no "⑤ list: $l"

# ── 2. 방 만들기 (음성 — 거절 · 폴더 안 생김) ──
before="$(ls "$R/rooms" | wc -l | tr -d ' ')"
refuse() { # label rc-expected args…
  local L="$1" E="$2"; shift 2
  "${ROOMS[@]}" new --root "$R" --now "$NOW" "$@" >/dev/null 2>&1; local rc=$?
  [ $rc = "$E" ] && [ "$(ls "$R/rooms" | wc -l | tr -d ' ')" = "$before" ] && ok "⑥ refused: $L (rc $rc · no folder)" || no "⑥ $L → rc $rc · rooms $(ls "$R/rooms" | wc -l)"
}
refuse "name ../x" 2 ../x --goal g
refuse "name .hidden" 2 .hidden --goal g
refuse "name with space" 2 'a b' --goal g
refuse "empty goal" 2 ok-name --goal '   '
refuse "newline in goal" 2 ok-name --goal "$(printf 'a\nb')"
refuse "newline in step" 2 ok-name --goal g --step "$(printf 'a\rb')"
refuse "thread not slack" 2 ok-name --goal g --thread https://evil.example.com/archives/C0123ABCD/p1700000000000001
refuse "thread host suffix" 2 ok-name --goal g --thread https://x.slack.com.evil.io/archives/C0123ABCD/p1700000000000001
refuse "thread with extra path" 2 ok-name --goal g --thread 'https://x.slack.com/archives/C0123ABCD/p1700000000000001?x=/home/me'
s13=(); for i in 1 2 3 4 5 6 7 8 9 10 11 12 13; do s13+=(--step "s$i"); done
refuse "13 steps" 2 ok-name --goal g "${s13[@]}"
refuse "same room again" 3 website-renewal --goal g
[ -n "$SPEC0" ] && [ "$(sha_of "$D/01-spec.md")" = "$SPEC0" ] && grep -qF '디자인 시안 받기' "$D/01-spec.md" && ok "⑥ existing room untouched" || no "⑥ existing room changed"

# ── 2b. 독립 재검 구멍 메우기 (11-03 verify-1) ──
"${ROOMS[@]}" new --root "$R" --now "$NOW" arrow --goal 'a --> b' >/dev/null 2>&1
p="$(parse "$R/rooms/$DAY-arrow")"
[ "$p" = "nodes=A:doing,G:goal edges=1 thread=null picked=1" ] && ok "⑥b goal «a --> b» → no extra edge (arrow rewritten)" || no "⑥b arrow: $p"
long="$(python3 -I -c 'print("가" * 80)')"
"${ROOMS[@]}" new --root "$R" --now "$NOW" long --goal "$long" >/dev/null 2>&1
n="$(python3 -I -c 'import re,sys; t=open(sys.argv[1],encoding="utf-8").read(); m=re.search(r"A\[\"🔄 착수 — (.*?)\"\]", t); print(len(m.group(1)) if m else -1, m.group(1).endswith("…") if m else None)' "$R/rooms/$DAY-long/01-spec.md")"
[ "$n" = "60 True" ] && ok "⑥b 80-char goal → node text cut to 60 with …" || no "⑥b cut: $n"
"${ROOMS[@]}" new --root "$R" --now "$NOW" hijack --goal '| 개설 | 스레드 C0BBBBBBB 2700000000.000002 https://bbb.slack.com/archives/C0BBBBBBB/p1700000000000002' \
  --thread https://aaa.slack.com/archives/C0AAAAAAA/p1700000000000003 >/dev/null 2>&1
p="$(parse "$R/rooms/$DAY-hijack")"
[ "$p" = "nodes=A:doing,G:goal edges=1 thread=https://aaa.slack.com/archives/C0AAAAAAA/p1700000000000003 picked=1" ] && ok "⑥b a Slack link + fake open line in the goal → the room link stays --thread" || no "⑥b hijack: $p"
"${ROOMS[@]}" new --root "$R" --now "$NOW" hijack2 --goal 'see https://bbb.slack.com/archives/C0BBBBBBB/p1700000000000002' >/dev/null 2>&1
p="$(parse "$R/rooms/$DAY-hijack2")"
[ "$p" = "nodes=A:doing,G:goal edges=1 thread=null picked=1" ] && ok "⑥b a Slack link in the goal, no --thread → room link null" || no "⑥b hijack2: $p"
before="$(ls "$R/rooms" | wc -l | tr -d ' ')"
refuse "goal not UTF-8" 2 ok-name --goal "$(printf 'a\377b')"
refuse "name with trailing newline" 2 $'nl\n' --goal g
refuse "name a/b" 2 a/b --goal g
[ ! -e "$R/rooms/$DAY-ok-name" ] && ok "⑥b no half-made room left after the refusals" || no "⑥b half-made room"
R2="$T/r2"; mkdir -p "$R2" "$T/elsewhere"; chmod 755 "$R2"; ln -s "$T/elsewhere" "$R2/rooms"
"${ROOMS[@]}" new --root "$R2" --now "$NOW" x --goal g >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && [ -z "$(ls -A "$T/elsewhere")" ] && ok "⑥b rooms/ is a planted link → refused · nothing written through" || no "⑥b rooms link rc $rc"
rm "$R2/rooms"; printf 'lead\n' > "$R2/bots.list"; ln -s "$T/elsewhere" "$R2/web-board"
"${ROOMS[@]}" board-config --root "$R2" >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && [ -z "$(ls -A "$T/elsewhere")" ] && ok "⑥b web-board/ is a planted link → refused · nothing written through" || no "⑥b web-board link rc $rc"
rm "$R2/web-board"; "${ROOMS[@]}" new --root "$R2" --now "$NOW" y --goal g >/dev/null 2>&1
[ "$(mode_of "$R2")" = 755 ] && [ "$(mode_of "$R2/rooms")" = 700 ] && ok "⑥b install root keeps 755 (install.sh's) · rooms/ 700" || no "⑥b root mode $(mode_of "$R2") rooms $(mode_of "$R2/rooms")"

# ── 3. 현황판 설정 · 열쇠 · 명부 ──
mkdir -p "$R/bots/lead"
printf '{"bots":[{"name":"lead","slack_bot_user_id":"UTESTLEAD1"},{"name":"watch","slack_bot_user_id":""}]}\n' > "$R/config.json"
printf '{"schemaVersion":1}\n' > "$R/bots/lead/harness.json"
conf="$("${ROOMS[@]}" board-config --root "$R" 2>&1)"; rc=$?
K="$R/web-board/web.key"
[ $rc = 0 ] && [ "$conf" = "$R/web-board/web.json" ] && ok "⑦ board-config → prints the config path only" || no "⑦ board-config rc $rc · $conf"
[ "$(mode_of "$K")" = 600 ] && [ "$(tr -d '\n' < "$K" | wc -c | tr -d ' ')" -ge 24 ] && [ "$(mode_of "$R/web-board")" = 700 ] && ok "⑦ key 0600 · 24+ chars · folder 0700" || no "⑦ key $(mode_of "$K")"
k1="$(sha_of "$K")"; "${ROOMS[@]}" board-config --root "$R" >/dev/null 2>&1
[ "$(sha_of "$K")" = "$k1" ] && ok "⑦ second board-config keeps the same key" || no "⑦ key rewritten"
printf '%s' "$conf" | grep -qF "$(tr -d '\n' < "$K")" && no "⑦ key value in board-config output" || ok "⑦ key value not in board-config output"
v="$(python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c["host"], "plugin_src" in c, c["rooms_root"]==sys.argv[2]+"/rooms", c["mods_config"]==sys.argv[2]+"/bots/lead/harness.json", c["key_file"]==sys.argv[2]+"/web-board/web.key")' "$conf" "$R")"
[ "$v" = "['127.0.0.1'] False True True True" ] && ok "⑦ web.json: 127.0.0.1 only · no plugin_src · rooms · first bot's harness.json · key file" || no "⑦ web.json: $v"
ro="$(node --input-type=module -e 'import fs from "fs"; const { rosterOf } = await import(process.argv[1]); const r = rosterOf(fs.readFileSync(process.argv[2], "utf8")); console.log(r.n, [...r.sid2bot].join(";"))' "$JOBS" "$R/web-board/roster.yaml")"
[ "$ro" = "2 UTESTLEAD1,lead" ] && ok "⑦ roster.yaml read by the board's rosterOf (2 bots · 1 Slack id)" || no "⑦ roster: $ro"
u="$("${ROOMS[@]}" board-url --root "$R")"
[ "$u" = "http://127.0.0.1:8794/?key=$(tr -d '\n' < "$K")" ] && ok "⑦ board-url = 127.0.0.1 address with the key" || no "⑦ board-url: $u"
E="$(mk_tmp m5-empty)"; "${ROOMS[@]}" board-config --root "$E/.slackmod" >/dev/null 2>&1; rc=$?
[ $rc = 1 ] && [ ! -e "$E/.slackmod/web-board/web.key" ] && ok "⑧ no bots → board-config rc 1 · no key" || no "⑧ no bots rc $rc"
rm -f "$K"; ln -s "$T/elsewhere.key" "$K"; "${ROOMS[@]}" board-config --root "$R" >/dev/null 2>&1; rc=$?
[ $rc = 1 ] && [ ! -e "$T/elsewhere.key" ] && ok "⑧ key path is a link → refused · nothing written through" || no "⑧ link key rc $rc"
rm -f "$K"; "${ROOMS[@]}" board-config --root "$R" --port 80 >/dev/null 2>&1; rc=$?
[ $rc = 2 ] && ok "⑧ --port 80 refused" || no "⑧ port 80 rc $rc"
rm -rf "$E"

# ── 4. slackmod 명령 + 진짜 현황판 서버 (이 저장소 src · 빈 포트) ──
mkdir -p "$R/bin" "$R/lib" "$R/app/mods-harness"
cp "$PORT_DIR/bin/slackmod" "$R/bin/slackmod"; cp "$PORT_DIR/lib/rooms.py" "$R/lib/rooms.py"
cp -R "$REPO_ROOT/src" "$R/app/mods-harness/src"; mkdir -p "$R/app/mods-harness/tools"; cp -R "$REPO_ROOT/tools/web-board" "$R/app/mods-harness/tools/web-board"
printf 'lead\nwatch\n' > "$R/bots.list"
SM=(env HOME="$H" SLACKMOD_ROOT="$R" "$BASHX" "$R/bin/slackmod")
PORT="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
o="$("${SM[@]}" room list 2>&1)"; printf '%s\n' "$o" | grep -qF website-renewal && ok "⑨ slackmod room list" || no "⑨ room list: $o"
"${SM[@]}" room bogus >/dev/null 2>&1; [ $? = 2 ] && ok "⑨ slackmod room bogus → rc 2" || no "⑨ room bogus"
"${SM[@]}" board bogus >/dev/null 2>&1; [ $? = 2 ] && ok "⑨ slackmod board bogus → rc 2" || no "⑨ board bogus"
"${SM[@]}" help | grep -qF 'slackmod board start' && ok "⑨ help lists board" || no "⑨ help"
if command -v node >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  o="$("${SM[@]}" board start --port "$PORT" 2>&1)"; rc=$?
  [ $rc = 0 ] && printf '%s\n' "$o" | grep -qF "현황판 켬" && ok "⑩ board start → on" || no "⑩ board start rc $rc · $o"
  printf '%s\n' "$o" | grep -qF "$(tr -d '\n' < "$K")" && no "⑩ key printed by board start" || ok "⑩ board start does not print the key"
  KEY="$(tr -d '\n' < "$K")"
  j="$(curl -s -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/jobs")"
  v="$(printf '%s' "$j" | python3 -I -c 'import json,sys; j=json.load(sys.stdin); r={x["room"]:x for x in j["rooms"]}; w=r.get(sys.argv[1]+"-website-renewal") or {}; print(len(j["rooms"]), [n["status"] for n in w.get("nodes",[])], w.get("thread_url"))' "$DAY" 2>&1)"
  [ "$v" = "7 ['doing', 'waiting', 'waiting', 'goal'] https://example-team.slack.com/archives/C0123ABCD/p1700000000000001" ] && ok "⑩ /api/jobs (key) carries the 7 rooms · seeded statuses · thread link" || no "⑩ /api/jobs: $v"
  printf '%s' "$j" | grep -qF "$H" && no "⑩ home path in /api/jobs" || ok "⑩ no home path in /api/jobs"
  c="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:$PORT/api/jobs")"
  [ "$c" = 401 ] && ok "⑩ /api/jobs without key → 401" || no "⑩ no-key status $c"
  c="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/")"
  [ "$c" = 200 ] && ok "⑩ / (board page) with key → 200" || no "⑩ page status $c"
  "${SM[@]}" board status | grep -qF '켜짐' && ok "⑩ board status = on" || no "⑩ board status"
  "${SM[@]}" board start --port "$PORT" | grep -qF '이미 켜져' && ok "⑩ second start = already on" || no "⑩ second start"
  "${SM[@]}" board stop | grep -qF '껐습니다' && ok "⑪ board stop" || no "⑪ board stop"
  sleep 1
  c="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/api/jobs")"
  [ "$c" = 000 ] && ok "⑪ stopped → nothing listens" || no "⑪ still answering $c"
  # 열쇠 권한이 넓으면 서버가 거절(rc 2) → 켜지지 않음 · 기록에 까닭
  chmod 644 "$K"
  "${SM[@]}" board start --port "$PORT" >/dev/null 2>&1; rc=$?
  [ $rc != 0 ] && grep -qF '열쇠 파일 권한이 넓음' "$R/web-board/server.log" && ok "⑫ key 0644 → board start fails · reason in server.log" || no "⑫ key 0644 rc $rc"
  chmod 600 "$K"
  # 손으로 host 0.0.0.0 으로 고친 설정 → board start 가 설정을 다시 써서 127.0.0.1 로 되돌림(설정은 생성물)
  python3 -I -c 'import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["host"]=["0.0.0.0"]; json.dump(c,open(p,"w"))' "$R/web-board/web.json"
  "${SM[@]}" board start --port "$PORT" >/dev/null 2>&1; rc=$?
  h2="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["host"])' "$R/web-board/web.json")"
  [ $rc = 0 ] && [ "$h2" = "['127.0.0.1']" ] && ok "⑫ hand-set host 0.0.0.0 → regenerated 127.0.0.1 on start" || no "⑫ host regen rc $rc · $h2"
  "${SM[@]}" board stop >/dev/null 2>&1
  # 서버 자체도 0.0.0.0 을 거절(rc 2) — 생성 설정을 거치지 않고 직접
  python3 -I -c 'import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["host"]=["0.0.0.0"]; json.dump(c,open(p,"w"))' "$R/web-board/web.json"
  HOME="$H" node "$R/app/mods-harness/tools/web-board/server.mjs" --config "$R/web-board/web.json" >/dev/null 2>&1; rc=$?
  [ $rc = 2 ] && ok "⑫ server itself refuses host 0.0.0.0 (rc 2)" || no "⑫ server 0.0.0.0 rc $rc"
  # 오래된 pid 파일이 남의 프로세스를 가리키면 «꺼짐» · 그 프로세스는 안 건드림(재검 M15)
  sleep 60 & SLEEPER=$!; disown "$SLEEPER" 2>/dev/null
  printf '%s\n' "$SLEEPER" > "$R/web-board/web.pid"
  "${SM[@]}" board status | grep -qF '꺼짐' && ok "⑬ stale pid file (an unrelated process) → board status = off" || no "⑬ stale pid status"
  "${SM[@]}" board stop >/dev/null 2>&1
  kill -0 "$SLEEPER" 2>/dev/null && ok "⑬ board stop leaves the unrelated process alone" || no "⑬ unrelated process gone"
  # 다시 켜기 규칙: 서버 끝 코드 75 만 다시 켬 · 2 는 한 번으로 끝(재검 M13) — 서버 자리에 끝 코드만 내는 가짜
  cp "$R/app/mods-harness/tools/web-board/server.mjs" "$T/server.mjs.real"
  printf '%s\n' 'import fs from "fs"; import path from "path"; const d = path.dirname(process.argv[3]); fs.appendFileSync(d + "/fake-runs", "x"); process.exit(Number(fs.readFileSync(d + "/fake-rc", "utf8")))' > "$R/app/mods-harness/tools/web-board/server.mjs"
  printf 2 > "$R/web-board/fake-rc"; : > "$R/web-board/fake-runs"
  "${SM[@]}" board start --port "$PORT" >/dev/null 2>&1
  [ "$(wc -c < "$R/web-board/fake-runs" | tr -d ' ')" = 1 ] && ok "⑭ server exit 2 → not restarted (1 run)" || no "⑭ exit 2 runs $(wc -c < "$R/web-board/fake-runs")"
  "${SM[@]}" board stop >/dev/null 2>&1
  printf 75 > "$R/web-board/fake-rc"; : > "$R/web-board/fake-runs"
  "${SM[@]}" board start --port "$PORT" >/dev/null 2>&1
  "${SM[@]}" board stop >/dev/null 2>&1
  r75="$(wc -c < "$R/web-board/fake-runs" | tr -d ' ')"
  [ "$r75" -ge 2 ] && ok "⑭ server exit 75 → restarted ($r75 runs)" || no "⑭ exit 75 runs $r75"
  cp "$T/server.mjs.real" "$R/app/mods-harness/tools/web-board/server.mjs"
  # 11-03 화면판 쪽과 칸 합의: 봇 칸 display_name(설정 → 명부 한글 → MOD 이름 → null) · 응답 글 전체 hide_words · 다시 켜도 손 칸 남음(⑮)
  mkdir -p "$H/.mods-harness/registry.d"
  printf '{"id":"lead-s1","bot":"lead"}\n' > "$H/.mods-harness/registry.d/lead-s1.json"
  printf '{"id":"watch-s1","bot":"watch"}\n' > "$H/.mods-harness/registry.d/watch-s1.json"
  "${ROOMS[@]}" new --root "$R" --now "$NOW" hidetest --goal '보고 Zqxsecret 정리' >/dev/null 2>&1
  python3 -I -c 'import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["bot_names"]={"lead":"리드 Zqxsecret 봇"}; c["hide_words"]=["zqxsecret"]; json.dump(c,open(p,"w"))' "$R/web-board/web.json"
  "${SM[@]}" board start >/dev/null 2>&1; rc=$?
  kept="$(python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c["bot_names"], c["hide_words"], c["port"]==int(sys.argv[2]))' "$R/web-board/web.json" "$PORT")"
  [ $rc = 0 ] && [ "$kept" = "{'lead': '리드 Zqxsecret 봇'} ['zqxsecret'] True" ] && ok "⑮ board start keeps hand-set bot_names · hide_words · port" || no "⑮ kept rc $rc · $kept"
  KEY="$(tr -d '\n' < "$K")"
  jj="$(curl -s -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/jobs")"
  bb="$(curl -s -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/board")"
  dj="$(printf '%s' "$jj" | python3 -I -c 'import json,sys; j=json.load(sys.stdin); print(sorted((b["display_name"] or "∅") for b in j["ops"]["bots"]))' 2>&1)"
  db="$(printf '%s' "$bb" | python3 -I -c 'import json,sys; j=json.load(sys.stdin); print(sorted(((b["bot"], b["display_name"] or "∅")) for b in j["bots"]))' 2>&1)"
  [ "$dj" = "['∅', '리드 봇']" ] && ok "⑮ /api/jobs ops.bots[].display_name = 설정 이름 · 없으면 null" || no "⑮ /api/jobs display_name: $dj"
  [ "$db" = "[('lead', '리드 봇'), ('watch', '∅')]" ] && ok "⑮ /api/board bots[].display_name = same fill · null" || no "⑮ /api/board display_name: $db"
  printf '%s%s' "$jj" "$bb" | grep -qi 'zqxsecret' && no "⑮ hide word in API answers" || ok "⑮ hide_words: 0 in /api/jobs + /api/board"
  printf '%s' "$jj" | grep -qF '보고 정리' && ok "⑮ hidden word removed in place (room text kept)" || no "⑮ room text after hide"
  # 가림 낱말은 방 글(jobsModel 가림이 먼저 지움)에도 · 설정 이름(응답 끝 hideWordsDeep 만 지움)에도 심음 → 두 응답 끝 가림을 빼면 RED(변이 S2·S3)
  # 음성 짝: hide_words 빈 목록 → 같은 낱말이 응답에 보임(위 0 이 헛돌지 않음)
  "${SM[@]}" board stop >/dev/null 2>&1
  python3 -I -c 'import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["hide_words"]=[]; json.dump(c,open(p,"w"))' "$R/web-board/web.json"
  "${SM[@]}" board start >/dev/null 2>&1
  jj="$(curl -s -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/jobs")"
  printf '%s' "$jj" | grep -qF 'Zqxsecret' && ok "⑮ negative pair: no hide_words → the word shows" || no "⑮ negative pair: word missing without hide_words"
  # ⑯ 11-03 /api/jobs 새 칸: display(설정 display_text · 기본 null) · setup(설치 단계 done/todo/unknown · 토큰 값·경로 0)
  dn="$(printf '%s' "$jj" | python3 -I -c 'import json,sys; j=json.load(sys.stdin); print(repr(j.get("display", "ABSENT")), type(j.get("setup")).__name__)' 2>&1)"
  [ "$dn" = "None dict" ] && ok "⑯ display = null by default · setup = object" || no "⑯ display/setup default: $dn"
  "${SM[@]}" board stop >/dev/null 2>&1
  cp "$PORT_DIR/lib/slackmod_config.py" "$R/lib/slackmod_config.py"
  mkdir -p "$R/bots/lead/slack" "$R/bots/watch/slack"
  # 미끼 토큰 = 조각으로 이어 붙임(공개 빌드 흔적 검사의 토큰 꼴에 시험 글 자체가 걸리지 않게)
  printf 'SLACK_BOT_TOKEN=%s%s\nSLACK_APP_TOKEN=%s%s\n' 'xox' 'b-111111111111-BAITM5TOKEN' 'xapp' '-1-AAAAAAAAAA-BAITM5APP' > "$R/bots/lead/slack/.env"; : > "$R/bots/watch/slack/.env"
  python3 -I -c 'import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["display_text"]={"titles":{sys.argv[2]:"숨김 시험 방"},"labels":{},"back":{}}; json.dump(c,open(p,"w"),ensure_ascii=False)' "$R/web-board/web.json" "$DAY-hidetest"
  "${SM[@]}" board start >/dev/null 2>&1; rc=$?
  kd="$(python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c["display_text"]["titles"].get(sys.argv[2]), c["setup_root"]==sys.argv[3])' "$R/web-board/web.json" "$DAY-hidetest" "$R" 2>&1)"
  [ $rc = 0 ] && [ "$kd" = "숨김 시험 방 True" ] && ok "⑯ board start keeps hand-set display_text · writes setup_root" || no "⑯ display_text kept rc $rc · $kd"
  jj="$(curl -s -m 10 -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/jobs")"
  v="$(printf '%s' "$jj" | python3 -I -c 'import json,sys; j=json.load(sys.stdin); st=j["setup"]["steps"]; ids=["0","1","2","3","4","5","6","7","7a","8","9","9-2","10","11","12","13","14","15","16","17","18"]; print(j["display"]["titles"].get(sys.argv[1]), sorted(st)==sorted(ids), set(st.values())<={"done","todo","unknown"}, st["8"], st["9-2"], st["13"], st["4"], st["11"])' "$DAY-hidetest" 2>&1)"
  [ "$v" = "숨김 시험 방 True True done done todo unknown unknown" ] && ok "⑯ /api/jobs display = 설정 그대로 · setup 21칸(봇 있음 done · 현황판 done · 토큰 한 봇 빔 todo · setup.json 없음 unknown)" || no "⑯ /api/jobs display/setup: $v"
  printf '%s' "$jj" | grep -qE 'BAITM5|xoxb-|xapp-' && no "⑯ token bait in /api/jobs" || ok "⑯ token bait: 0 in /api/jobs"
  grep -qF 'BAITM5TOKEN' "$R/bots/lead/slack/.env" && ok "⑯ token bait present in the source .env (positive pair)" || no "⑯ bait missing from .env"
  printf '%s' "$jj" | grep -qF "$H" && no "⑯ home path in /api/jobs" || ok "⑯ home path: 0 in /api/jobs"
  "${SM[@]}" board stop >/dev/null 2>&1
else
  echo "SKIP ⑩–⑮ (node or curl missing) — skipped ≠ passed"
fi
finish
