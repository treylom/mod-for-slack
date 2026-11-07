#!/usr/bin/env bash
# m4-scan.sh — the five look-around tools (envscan · history · projects · models · recommend) against FAKE homes only:
#   two fake HOMEs: «empty computer» (nothing) and «full computer» (settings · .claude.json with an mcp key «hindsight» and a
#   token-shaped bait value · installed_plugins · skills · a vault with 3 notes · 2 conversation logs + 1 old one · work folders
#   with 2 git repos and 1 folder link) · fake claude / codex / tmux programs on a narrowed PATH (the real ones are never run).
#   Every tool run: HOME fingerprint before = after (read only). projects: a folder link inside root is not followed either ·
#   models: «확인됨» only for end code 0 + is_error the boolean false (one fake per broken condition).
#   bash setup/tests/m4-scan.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m4-scan)"
trap 'rm -rf "$T"' EXIT
LIB="$SETUP_DIR/lib"; CAT="$SETUP_DIR/catalog/recommend.tsv"; FIX="$SETUP_TESTS_DIR/fixtures/m4"
PY="$(command -v python3)"
TOK="xoxb-""111111111111-222222222222-BAITBAITBAITBAITBAIT"   # bait: a bot-token shape (split so this file stays clean)
SECRETW="SECRET""WORD123"                                        # bait: words inside a message

# q FILE EXPR → python expression over the JSON «d» (printed with print())
q() { "$PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print('"$2"')' "$1"; }
# baits FILE POS NEG → «pos neg» counts in one command (positive bait must be > 0, negative bait must be 0)
baits() { printf '%s %s' "$(command grep -c -E -e "$2" "$1")" "$(command grep -c -E -e "$3" "$1")"; }

# ── fake programs (outside every HOME) ──
mkdir -p "$T/bin-full" "$T/bin-empty" "$T/fake"
printf '#!/bin/sh\necho "2.1.9 (Claude Code)"\n' > "$T/bin-full/claude"
printf '#!/bin/sh\nexit 0\n' > "$T/bin-full/codex"
printf '#!/bin/sh\nexit 0\n' > "$T/bin-full/tmux"
cat > "$T/fake/claude-ok" <<'SH'
#!/bin/sh
# answers like `claude -p … --output-format json`: opus ends with error_max_turns (rc 0 · is_error false = still an answer), the rest succeed
m=""; while [ $# -gt 0 ]; do [ "$1" = "--model" ] && m="$2"; shift; done
if [ "$m" = opus ]; then echo '{"type":"result","subtype":"error_max_turns","is_error":false,"num_turns":2}'; exit 0; fi
echo '{"type":"result","subtype":"success","is_error":false,"result":"OK"}'
SH
cat > "$T/fake/claude-auth" <<'SH'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login"}'
exit 1
SH
cat > "$T/fake/claude-slow" <<'SH'
#!/bin/sh
sleep 5
echo '{"type":"result","subtype":"success","is_error":false,"result":"OK"}'
SH
printf '#!/bin/sh\n[ "$1" = exec ] && exit 0\nexit 9\n' > "$T/fake/codex-ok"
printf '#!/bin/sh\nexit 1\n' > "$T/fake/codex-bad"
chmod 755 "$T/bin-full/"* "$T/fake/"*

# ── «empty computer» ──
EH="$T/empty"; mkdir -p "$EH"

# ── «full computer» ──
FH="$T/full"
mkdir -p "$FH/.claude/skills/note" "$FH/.claude/skills/nofile" "$FH/.claude/projects/p-alpha/memory" "$FH/.claude/projects/p-beta" \
  "$FH/.claude/plugins/cache/demo-tool/skills/helper" "$FH/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin" \
  "$FH/.codex" "$FH/notes/.obsidian" "$FH/notes/sub" \
  "$FH/work/alpha/.git" "$FH/work/beta" "$FH/work/gamma" "$FH/work/a/b/c/.git" "$FH/work/.hidden/.git" "$FH/work/node_modules/pkg/.git" \
  "$FH/elsewhere/repo/.git" "$FH/outside/.git"
printf 'gitdir: ../somewhere\n' > "$FH/work/beta/.git"          # .git as a FILE (worktree) still counts
printf '# rules\n' > "$FH/work/gamma/CLAUDE.md"
printf '# rules\n' > "$FH/work/a/b/AGENTS.md"                     # depth 2 → listed
printf '# rules\n' > "$FH/work/a/b/c/CLAUDE.md"                   # depth 3 → not listed
ln -s "$FH/elsewhere/repo" "$FH/work/link"                        # folder link → not followed
printf -- '---\nname: note\n---\nTake notes.\n' > "$FH/.claude/skills/note/SKILL.md"
printf 'no skill file here\n' > "$FH/.claude/skills/nofile/README.md"
printf -- '---\nname: helper\n---\nHelp.\n' > "$FH/.claude/plugins/cache/demo-tool/skills/helper/SKILL.md"
printf '# memory\n' > "$FH/.claude/projects/p-alpha/memory/MEMORY.md"
cp "$FIX/marketplace.json" "$FH/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json"
printf 'model = "gpt-test"\n[profiles.x]\nmodel = "other"\n' > "$FH/.codex/config.toml"
printf '# n1\n' > "$FH/notes/one.md"; printf '# n2\n' > "$FH/notes/two.md"; printf '# n3\n' > "$FH/notes/sub/three.md"
printf '{}\n' > "$FH/notes/.obsidian/app.json"
"$PY" -I - "$FH" "$TOK" "$SECRETW" <<'PY'
import json, sys
h, tok, sw = sys.argv[1:4]
json.dump({'model': 'my-model-x', 'env': {'X_TOKEN': tok}}, open(h + '/.claude/settings.json', 'w'), indent=1)
json.dump({'env': {'X_TOKEN': tok}, 'mcpServers': {'hindsight': {'command': 'hs', 'env': {'KEY': tok}}, 'notes-search': {'command': 'ns'}, tok: {}},
           'projects': {h + '/work/alpha': {'mcpServers': {'kumiho-memory': {'url': 'http://localhost:1/' + tok}}}}},
          open(h + '/.claude.json', 'w'), indent=1)
json.dump({'version': 2, 'plugins': {
    'demo-tool@demo-market': [{'scope': 'user', 'installPath': h + '/.claude/plugins/cache/demo-tool', 'version': '1.0.0', 'installedAt': '2026-01-01T00:00:00Z'}],
    'prompt-engineering-skills@demo-market': [{'scope': 'user', 'installPath': h + '/.claude/plugins/cache/none', 'version': '1.0.0', 'installedAt': '2026-01-01T00:00:00Z'}]}},
    open(h + '/.claude/plugins/installed_plugins.json', 'w'), indent=1)
def tu(name, **inp):
    return {'type': 'tool_use', 'id': 'tu_' + name, 'name': name, 'input': inp}
def asst(cwd, *blocks):
    return {'type': 'assistant', 'cwd': cwd, 'timestamp': '2026-10-01T00:00:00Z', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'thinking about ' + sw}] + list(blocks)}}
def user(cwd):
    return {'type': 'user', 'cwd': cwd, 'timestamp': '2026-10-01T00:00:00Z', 'message': {'role': 'user', 'content': 'please keep ' + sw + ' private'}}
A, B, O, L = h + '/work/alpha', h + '/work/beta', h + '/outside', h + '/work/link'
s1 = [user(A), asst(A, tu('Edit', file_path=A + '/a.md', old_string=sw), tu('Edit', file_path=A + '/b.md')),
      asst(A, tu('Edit', file_path=A + '/c.md'), tu('Write', file_path=A + '/x.py', content=sw)),
      asst(L, tu('WebSearch', query=sw), tu('WebSearch', query='q2'), tu('WebSearch', query='q3'))]
s2 = [user(B), asst(B, tu('Edit', file_path=B + '/d.md'), tu('Write', file_path=B + '/e.md')),
      asst(A, tu('Edit', file_path=B + '/y.py'), tu('WebSearch', query='q4'), tu('WebSearch', query='q5')),
      asst(O, tu('Read', file_path=O + '/t.csv'))]
old = [asst(A, tu('Edit', file_path=A + '/z.go'))]
def dump(path, rows, broken=False):
    with open(path, 'w') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
        if broken:
            f.write('{"type": "assistant", "cwd": \n')
dump(h + '/.claude/projects/p-alpha/s1.jsonl', s1, broken=True)
dump(h + '/.claude/projects/p-beta/s2.jsonl', s2)
dump(h + '/.claude/projects/p-alpha/old.jsonl', old)
PY
touch -t 202001010000 "$FH/.claude/projects/p-alpha/old.jsonl"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# runs one tool with a narrowed PATH and a fixed SHELL (no real claude/codex/tmux) → stdout to $2, rc in RC, HOME unchanged in SAME
run_tool() { # run_tool HOME OUTFILE BINDIR UNAME python-args…
  local h="$1" o="$2" bd="$3" un="$4"; shift 4
  local before after
  before="$(listing "$h")"
  ( export PATH="$bd:/usr/bin:/bin"; export SHELL=/bin/zsh; unset WSL_DISTRO_NAME
    if [ -n "$un" ]; then export MODS_FAKE_UNAME="$un"; else unset MODS_FAKE_UNAME; fi
    "$PY" -I "$@" > "$o" 2> "$o.err" ); RC=$?
  after="$(listing "$h")"
  [ "$before" = "$after" ] && SAME=1 || SAME=0
}
FPN=0; FPBAD=""
fp_check() { FPN=$((FPN + 1)); [ "$SAME" = 1 ] || FPBAD="$FPBAD $1"; }

# ── envscan ──
run_tool "$EH" "$T/env-empty.json" "$T/bin-empty" Linux "$LIB/envscan.py" --home "$EH"; fp_check envscan-empty
got="$(q "$T/env-empty.json" '"|".join(map(str,[d["os"],d["wsl"],d["shell"],d["mux"],d["claude"],d["codex"]["found"],d["memory"],d["wiki"]["vaults"],d["plugins"],d["skills"],d["mcp"],d["official"]]))')"
want="Linux|False|zsh|[]|{'found': False, 'version': None}|False|{'auto': 'on', 'auto_dirs': 0, 'external': []}|[]|[]|[]|[]|{'path': None, 'count': 0}"
[ $RC -eq 0 ] && [ "$got" = "$want" ] && [ -z "$(ls -A "$EH")" ] && ok "envscan empty computer: rc 0 · every value empty / off-by-default («${got}»)" || { no "envscan empty rc=$RC got=$got"; cat "$T/env-empty.json.err"; }

run_tool "$FH" "$T/env-full.json" "$T/bin-full" "MINGW64_NT-10.0" "$LIB/envscan.py" --home "$FH"; fp_check envscan-full
got="$(q "$T/env-full.json" '"|".join(map(str,[d["os"],d["shell"],d["mux"],d["claude"],d["codex"]["found"],d["memory"],d["plugins"],d["skills"],d["mcp"]]))')"
want="Windows|zsh|['tmux']|{'found': True, 'version': '2.1.9'}|True|{'auto': 'on', 'auto_dirs': 1, 'external': [{'name': 'hindsight', 'via': 'mcp'}, {'name': 'kumiho-memory', 'via': 'mcp'}]}|['demo-tool@demo-market', 'prompt-engineering-skills@demo-market']|['helper', 'note']|['hindsight', 'kumiho-memory', 'notes-search']"
[ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "envscan full computer: MINGW uname → Windows · tmux · claude 2.1.9 · codex · memory (auto on · 1 MEMORY.md · hindsight + kumiho by mcp key) · plugins · skills (user + plugin) · mcp (top + project)" || { no "envscan full rc=$RC"; printf 'got  %s\nwant %s\n' "$got" "$want"; cat "$T/env-full.json.err"; }
got="$(q "$T/env-full.json" 'd["wiki"]["vaults"]')"
[ "$got" = "[{'path': '$FH/notes', 'notes': 3}]" ] && ok "envscan wiki: the .obsidian folder found · notes = 3 md" || no "envscan wiki: $got"
got="$(q "$T/env-full.json" 'd["official"]')"
[ "$got" = "{'path': '$FH/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json', 'count': 14}" ] && ok "envscan official: the list under HOME found · 14 names" || no "envscan official: $got"
set -- $(baits "$T/env-full.json" hindsight BAITBAIT)
[ "$1" -gt 0 ] && [ "$2" = 0 ] && ok "envscan reads keys only: «hindsight» key shown ($1) · token bait in env / mcp values / a token-shaped key name 0 (미끼 2/2)" || no "envscan bait: pos=$1 neg=$2"
run_tool "$FH" "$T/env-lin.json" "$T/bin-empty" Linux "$LIB/envscan.py" --home "$FH" --official "$T/no-such.json"; fp_check envscan-official-override
got="$(q "$T/env-lin.json" '[d["os"], d["official"], d["claude"]["found"]]')"
[ "$got" = "['Linux', {'path': None, 'count': 0}, False]" ] && ok "envscan: MODS_FAKE_UNAME=Linux → Linux · --official missing file → null/0 · claude not on PATH → found false" || no "envscan override: $got"
run_tool "$FH" "$T/env-full2.json" "$T/bin-full" "MINGW64_NT-10.0" "$LIB/envscan.py" --home "$FH"; fp_check envscan-again
cmp -s "$T/env-full.json" "$T/env-full2.json" && ok "envscan: same input twice → same bytes" || no "envscan output differs between two runs"
MH="$T/memhomes"; mkdir -p "$MH/off/.claude" "$MH/broken/.claude"
printf '{"autoMemoryEnabled": false}\n' > "$MH/off/.claude/settings.json"; printf '{bad' > "$MH/broken/.claude/settings.json"
run_tool "$MH/off" "$T/env-off.json" "$T/bin-empty" Linux "$LIB/envscan.py" --home "$MH/off"; fp_check envscan-off
run_tool "$MH/broken" "$T/env-broken.json" "$T/bin-empty" Linux "$LIB/envscan.py" --home "$MH/broken"; fp_check envscan-broken
got="$(q "$T/env-off.json" 'd["memory"]["auto"]') $(q "$T/env-broken.json" 'd["memory"]["auto"]')"
[ "$got" = "off unknown" ] && ok "envscan auto memory: autoMemoryEnabled false → off · broken settings → unknown (missing → on, above)" || no "envscan auto memory: $got"

# ── history ──
run_tool "$EH" "$T/notice.txt" "$T/bin-empty" "" "$LIB/history.py" --notice; fp_check history-notice
grep -q '^설치 도우미가 이 컴퓨터의 Claude Code 대화 기록을 읽어 숫자만 셉니다 — .*«기록 읽지 않기»를 고르세요\.$' "$T/notice.txt" && [ "$(wc -l < "$T/notice.txt" | tr -d ' ')" = 1 ] \
  && ok "history --notice: the notice line only" || { no "history notice"; cat "$T/notice.txt"; }
run_tool "$FH" "$T/hist.json" "$T/bin-empty" "" "$LIB/history.py" --home "$FH" --days 30 --now "$NOW"; fp_check history-full
got="$(q "$T/hist.json" '"|".join(map(str,[d["read"],d["days"],d["sessions"],d["folders"],d["tools"],d["exts"],d["kinds"],d["skipped_lines"]]))')"
want="True|30|2|[{'path': '$FH/work/alpha', 'sessions': 2}, {'path': '$FH/outside', 'sessions': 1}, {'path': '$FH/work/beta', 'sessions': 1}, {'path': '$FH/work/link', 'sessions': 1}]|{'Edit': 5, 'Read': 1, 'WebSearch': 5, 'Write': 2}|{'.csv': 1, '.md': 5, '.py': 2}|{'code': 2, 'writing': 5, 'research': 5, 'data': 1}|1"
[ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "history: 2 sessions (old file left out) · folders by cwd (most first · ties by path) · tools · extensions only · kinds · 1 broken line skipped" || { no "history counts rc=$RC"; printf 'got  %s\nwant %s\n' "$got" "$want"; cat "$T/hist.json.err"; }
set -- $(baits "$T/hist.json" WebSearch "$SECRETW")
[ "$1" -gt 0 ] && [ "$2" = 0 ] && ok "history: no message text in the output — tool name shown ($1) · «SECRETWORD» bait 0 (미끼 2/2)" || no "history bait: pos=$1 neg=$2"
run_tool "$FH" "$T/hist-long.json" "$T/bin-empty" "" "$LIB/history.py" --home "$FH" --days 3650 --now "$NOW"; fp_check history-days
got="$(q "$T/hist-long.json" '[d["sessions"], d["exts"].get(".go", 0)]')"
[ "$got" = "[3, 1]" ] && ok "history --days: 3650 days takes the 2020 file in (3 sessions · .go 1) — 30 days leaves it out" || no "history --days: $got"
run_tool "$FH" "$T/hist2.json" "$T/bin-empty" "" "$LIB/history.py" --home "$FH" --days 30 --now "$NOW"; fp_check history-again
cmp -s "$T/hist.json" "$T/hist2.json" && ok "history: same input twice → same bytes" || no "history output differs"
run_tool "$EH" "$T/hist-empty.json" "$T/bin-empty" "" "$LIB/history.py" --home "$EH" --now "$NOW"; fp_check history-empty
[ "$(q "$T/hist-empty.json" '[d["sessions"], d["folders"], d["tools"], d["skipped_lines"]]')" = "[0, [], {}, 0]" ] && ok "history empty computer: 0 sessions · nothing counted" || no "history empty"

# ── projects ──
run_tool "$FH" "$T/proj.json" "$T/bin-empty" "" "$LIB/projects.py" --root "$FH/work" --history "$T/hist.json" --home "$FH"; fp_check projects
got="$(q "$T/proj.json" '[c["path"][len(d["root"])+1:] + ":" + "+".join(c["why"]) for c in d["candidates"]]')"
want="['alpha:git+history:2', 'beta:git+history:1', 'a/b:agents_md', 'gamma:claude_md']"
[ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "projects: git folder + git file + CLAUDE.md + AGENTS.md (depth 2) · history first · then path" || { no "projects rc=$RC got=$got"; cat "$T/proj.json.err"; }
set -- $(baits "$T/proj.json" "work/alpha" "elsewhere|/link|outside|a/b/c|hidden|node_modules")
[ "$1" -gt 0 ] && [ "$2" = 0 ] && ok "projects: folder link not followed · history folder outside root / through the link left out · depth 3 · hidden · node_modules 0 (미끼 2/2)" || no "projects bait: pos=$1 neg=$2"
run_tool "$FH" "$T/proj-bad.json" "$T/bin-empty" "" "$LIB/projects.py" --root "$FH/no-such-folder"; fp_check projects-bad
[ $RC -eq 2 ] && [ "$(wc -l < "$T/proj-bad.json.err" | tr -d ' ')" = 1 ] && [ ! -s "$T/proj-bad.json" ] && ok "projects: root missing → rc 2 + one line" || no "projects bad root rc=$RC"
run_tool "$FH" "$T/proj-d3.json" "$T/bin-empty" "" "$LIB/projects.py" --root "$FH/work" --depth 3; fp_check projects-depth3
q "$T/proj-d3.json" '[c["path"] for c in d["candidates"]]' | grep -q "a/b/c'" && ok "projects --depth 3: the depth-3 folder appears only when asked (depth 2 default leaves it out)" || no "projects --depth 3"
# a folder link that points INSIDE root (so the «outside root» check cannot catch it) is still not followed
LR="$T/linkroot"; mkdir -p "$LR/real/.git"; ln -s "$LR/real" "$LR/lnk"
run_tool "$LR" "$T/proj-lnk.json" "$T/bin-empty" "" "$LIB/projects.py" --root "$LR" --depth 2; fp_check projects-inner-link
set -- $(baits "$T/proj-lnk.json" '/real"' '/lnk')
[ $RC -eq 0 ] && [ "$1" -gt 0 ] && [ "$2" = 0 ] && ok "projects: a folder link to a folder inside root → not a candidate (real $1 · lnk $2 · 미끼 2/2)" || { no "projects inner link: real=$1 lnk=$2 rc=$RC"; cat "$T/proj-lnk.json"; }

# ── models ──
run_tool "$FH" "$T/mod-ok.json" "$T/bin-empty" "" "$LIB/models.py" --home "$FH" --probe --claude "$T/fake/claude-ok" --codex "$T/fake/codex-ok" --timeout 10; fp_check models-ok
got="$(q "$T/mod-ok.json" '[(m["name"], m["from"], m["probe"], m["status"]) for m in d["models"]]')"
want="[('haiku', 'alias', 'ok', '확인됨'), ('sonnet', 'alias', 'ok', '확인됨'), ('opus', 'alias', 'ok', '확인됨'), ('my-model-x', 'settings', 'ok', '확인됨'), ('gpt-test', 'codex-config', 'ok', '확인됨')]"
[ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "models --probe answering: aliases + settings model + codex config model → 확인됨 (error_max_turns with rc 0 · is_error false counts as an answer)" || { no "models ok rc=$RC"; printf 'got  %s\nwant %s\n' "$got" "$want"; }
run_tool "$FH" "$T/mod-auth.json" "$T/bin-empty" "" "$LIB/models.py" --home "$FH" --probe --claude "$T/fake/claude-auth" --codex "$T/fake/codex-bad" --timeout 10; fp_check models-auth
got="$(q "$T/mod-auth.json" 'sorted(set((m["probe"], m["status"]) for m in d["models"]))')"
[ "$got" = "[('no-answer', '확인 안 됨')]" ] && [ "$(q "$T/mod-auth.json" 'len(d["models"])')" = 5 ] && ok "models --probe login error (success + is_error) · codex rc≠0 → 확인 안 됨 for all 5" || no "models auth: $got"
start=$SECONDS
run_tool "$EH" "$T/mod-slow.json" "$T/bin-empty" "" "$LIB/models.py" --home "$EH" --probe --claude "$T/fake/claude-slow" --timeout 2; fp_check models-timeout
took=$((SECONDS - start))
got="$(q "$T/mod-slow.json" '[(m["name"], m["status"]) for m in d["models"]]')"
[ "$got" = "[('haiku', '확인 안 됨'), ('sonnet', '확인 안 됨'), ('opus', '확인 안 됨')]" ] && [ "$took" -lt 12 ] && ok "models --probe time-out (--timeout 2 · fake sleeps 5) → 확인 안 됨 · 3 names in ${took}s (the sleeping child is ended too)" || no "models timeout: $got took=${took}s"
run_tool "$FH" "$T/mod-name.json" "$T/bin-empty" "" "$LIB/models.py" --home "$FH" --claude "$T/fake/claude-slow" --codex "$T/fake/codex-ok"; fp_check models-notrun
got="$(q "$T/mod-name.json" 'sorted(set((m["probe"], m["status"]) for m in d["models"]))') $(q "$T/mod-name.json" 'len(d["models"])')"
[ "$got" = "[('not-run', '이름만')] 5" ] && ok "models without --probe: nothing run → 이름만 for all 5" || no "models not-run: $got"
# «확인됨» = end code 0 AND is_error is the boolean false — each shape below breaks exactly one of those (the real shapes, measured:
# answering = rc 0 + {"subtype":"success","is_error":false} · unknown model = rc 1 + {"subtype":"success","is_error":true})
mkdir -p "$T/shape"
shape() { printf '#!/bin/sh\n%s\n' "$2" > "$T/shape/$1"; chmod 755 "$T/shape/$1"; }
shape good       "echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"OK\"}'"
shape maxturns   "echo '{\"type\":\"result\",\"subtype\":\"error_max_turns\",\"is_error\":false}'"
shape maxerr_rc1 "echo '{\"type\":\"result\",\"subtype\":\"error_max_turns\",\"is_error\":true,\"result\":\"API Error: 401\"}'; exit 1"
shape ok_rc1     "echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"OK\"}'; exit 1"
shape nokey_rc1  "echo '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Credit balance is too low\"}'; exit 1"
shape nokey_rc0  "echo '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"OK\"}'"
shape strtrue    "echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":\"true\",\"result\":\"x\"}'; exit 1"
shape strfalse   "echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":\"false\",\"result\":\"OK\"}'"
shape array      "echo '[{\"type\":\"system\"},{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"OK\"}]'"
shape broken     "echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,'"
for s in good maxturns maxerr_rc1 ok_rc1 nokey_rc1 nokey_rc0 strtrue strfalse array broken; do
  run_tool "$EH" "$T/shape-$s.json" "$T/bin-empty" "" "$LIB/models.py" --home "$EH" --probe --claude "$T/shape/$s" --timeout 10; fp_check "models-$s"
  got="$(q "$T/shape-$s.json" 'sorted(set(m["status"] for m in d["models"]))')"
  case "$s" in good|maxturns) want="['확인됨']" ;; *) want="['확인 안 됨']" ;; esac
  [ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "models --probe shape $s → $got" || no "models shape $s: got $got want $want"
done

# ── recommend ──
printf '["exa"]\n' > "$T/declined.json"
printf '{"work": ["code"]}\n' > "$T/answers-code.json"
run_tool "$EH" "$T/rec-empty.json" "$T/bin-empty" "" "$LIB/recommend.py" --env "$T/env-empty.json" --history "$T/hist-empty.json" --catalog "$CAT"; fp_check recommend-empty
got="$(q "$T/rec-empty.json" '[d["base"], d["add"], d["skip"]]')"
[ $RC -eq 0 ] && [ "$got" = "[['base-memory', 'base-search', 'base-help', 'base-doctor'], [], []]" ] && ok "recommend empty computer: base 4 · add 0 (no condition holds) · skip 0" || { no "recommend empty rc=$RC got=$got"; cat "$T/rec-empty.json.err"; }
run_tool "$FH" "$T/rec-full.json" "$T/bin-empty" "" "$LIB/recommend.py" --env "$T/env-full.json" --history "$T/hist.json" --catalog "$CAT" --declined "$T/declined.json"; fp_check recommend-full
got="$(q "$T/rec-full.json" '[[a["id"] for a in d["add"]], [(s["id"], s["why"]) for s in d["skip"]]]')"
want="[['knowledge-manager', 'notion', 'firecrawl'], [('prompt-engineering-skills', '이미 있음'), ('exa', '전에 거절')]]"
[ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "recommend full computer: wiki row + writing row + research row suggested · installed one = 이미 있음 · declined one = 전에 거절 · code rows absent (2 < 5)" || { no "recommend full rc=$RC"; printf 'got  %s\nwant %s\n' "$got" "$want"; cat "$T/rec-full.json.err"; }
[ "$(q "$T/rec-full.json" '[a["how"] for a in d["add"] if a["id"] == "notion"][0]')" = "/plugin install notion@claude-plugins-official" ] && ok "recommend: {market} in how → claude-plugins-official" || no "recommend how"
run_tool "$FH" "$T/rec-full2.json" "$T/bin-empty" "" "$LIB/recommend.py" --env "$T/env-full.json" --history "$T/hist.json" --catalog "$CAT" --declined "$T/declined.json"; fp_check recommend-again
cmp -s "$T/rec-full.json" "$T/rec-full2.json" && ok "recommend: same input twice → same bytes" || no "recommend output differs"
run_tool "$FH" "$T/rec-code.json" "$T/bin-empty" "" "$LIB/recommend.py" --env "$T/env-full.json" --history "$T/hist.json" --answers "$T/answers-code.json" --catalog "$CAT"; fp_check recommend-answers
got="$(q "$T/rec-code.json" '[[a["id"] for a in d["add"] if a["id"] in ("context7","code-review","pr-review-toolkit")], [(s["id"], s["why"]) for s in d["skip"] if s["id"] == "pr-review-toolkit"]]')"
[ "$got" = "[['context7', 'code-review'], [('pr-review-toolkit', '겹침:code-review')]]" ] && ok "recommend answers.work code → code rows · the second review tool = 겹침:code-review" || no "recommend answers/overlap: $got"
"$PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); d["official"]={"path":None,"count":0}; json.dump(d,open(sys.argv[2],"w"))' "$T/env-full.json" "$T/env-noofficial.json"
run_tool "$FH" "$T/rec-nooff.json" "$T/bin-empty" "" "$LIB/recommend.py" --env "$T/env-noofficial.json" --history "$T/hist.json" --catalog "$CAT"; fp_check recommend-no-official
got="$(q "$T/rec-nooff.json" '[[a["id"] for a in d["add"]], [(s["id"], s["why"]) for s in d["skip"]]]')"
[ "$got" = "[['knowledge-manager'], [('prompt-engineering-skills', '이미 있음'), ('notion', '목록에 없음'), ('exa', '목록에 없음'), ('firecrawl', '목록에 없음')]]" ] && ok "recommend: no official list → every official row «목록에 없음» · ours row still suggested" || no "recommend no official: $got"
rows="$(command grep -c -v -e '^#' "$CAT")"; offi="$(cut -f3 "$CAT" | command grep -c -x official)"
"$PY" -I - "$CAT" "$FIX/marketplace.json" > "$T/catcheck.txt" <<'PY'
import json, sys
names = {p['name'] for p in json.load(open(sys.argv[2]))['plugins']}
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1], encoding='utf-8') if l.strip() and not l.startswith('#')]
add = [r for r in rows if r[1] == 'add']
print(len([r for r in rows if r[1] == 'base']), len(add), all(len(r) == 8 for r in rows),
      all(r[0] in names for r in rows if r[2] == 'official'), all(r[3] != 'always' and r[5] for r in add))
PY
[ "$(cat "$T/catcheck.txt")" = "4 15 True True True" ] && ok "catalog: base 4 · add 15 · 8 columns · official names in the test list · no add row is «always» (rows $rows · official $offi)" || no "catalog shape: $(cat "$T/catcheck.txt")"

# ── read only, all tools ──
[ -z "$FPBAD" ] && ok "read only: HOME fingerprint before = after for all $FPN tool runs" || no "a tool changed a HOME:$FPBAD"
finish
