#!/usr/bin/env bash
# m3-g34-live.sh — ONE real model run of the wizard for G3 (existing setups → copies only · three role defaults) and G4 (persona
# files from the role skeletons → the pre-install check), in a throwaway HOME, on the public layout built from a real bundle.
#   bash setup/tests/m3-g34-live.sh <bundle.zip> [evidence-dir]
# Same run shape as m3-live-wizard.sh (relay variables only in the child's environment · MODS_SETUP_NO_OPEN=1 = no terminal
# window · prompt first · stdin closed). Bots: alpha (lead) · bravo (watch) · charlie (research) from the role skeletons +
# oldbot carried over from a fake older setup. Hard checks read the disk, not the model's words:
#   G3 · copies under ~/.slackmod/import/<time>/ + MANIFEST · the old bot's file in its new folder · originals byte-identical ·
#        bait secrets in 0 files · each of the three role bots got its role skeleton (persona.md + CLAUDE.md, role line = its role)
#   G4 · each role bot's persona.md carries the fill mark and its own name, and persona-check passes on it (rc 0) · the same check
#        on a copy with a planted token shape / a left-over <BOT_NAME> stub fails with «걸림 · 비밀값» / «걸림 · 자리표시자»
#   G2 · doctor summary counts 12 cells (no blank cell) · a second «install.sh --plan» says 바뀜 0
# Costs one model session. rc 0 = all hard checks PASS. Not in run-all (needs a bundle and the relay variables).
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
ZIP="${1:?bundle.zip}"; EVID="${2:-}"
[ -n "${ANTHROPIC_BASE_URL:-}" ] && [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || { echo "FAIL the relay variables ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN are not in this environment"; exit 2; }
T="$(mk_tmp m3-g34)"
keep_evidence() {
  [ -n "$EVID" ] || return 0
  mkdir -p "$EVID"
  cp "$T/live.out" "$T/live.meta" "$T/answers.json" "$EVID/" 2>/dev/null
  cp "$T"/check-*.txt "$T"/doctor.txt "$EVID/" 2>/dev/null
  [ -f "$H/.slackmod/setup.json" ] && cp "$H/.slackmod/setup.json" "$EVID/setup.json"
  for b in alpha bravo charlie oldbot; do
    [ -d "$H/bots/$b" ] && mkdir -p "$EVID/bots/$b" && find "$H/bots/$b" -maxdepth 1 -type f -name '*.md' -exec cp {} "$EVID/bots/$b/" \;
  done
  m="$(ls "$H"/.slackmod/import/*/MANIFEST.txt 2>/dev/null | head -1)"; [ -n "$m" ] && cp "$m" "$EVID/import-MANIFEST.txt"
  return 0
}
trap 'keep_evidence; rm -rf "$T"' EXIT
make_public_tree "$T/tree" "$ZIP" || { echo "FAIL unzip"; exit 1; }
TREE="$(cd "$T/tree" && pwd -P)"; B="$TREE/slackmod"
H="$T/home"; mkdir -p "$H"
SOUL="so""ul.md"
B1="xoxb-""111111111111-222222222222-BAITBAITBAITBAITBAIT"; B2="sk-""BAITBAITBAITBAITBAITBAIT"
# a fake older setup (benign text + bait secrets that must never be copied or printed)
mkdir -p "$H/.claude/agents" "$H/.claude/channels/oldbot" "$H/.codex"
printf '# my notes\nI like tea.\n' > "$H/.claude/CLAUDE.md"
printf -- '---\nname: reviewer\ndescription: reviews code\n---\nReview code.\n' > "$H/.claude/agents/reviewer.md"
printf '# old bot\nI am the old bot.\n' > "$H/.claude/channels/oldbot/$SOUL"
printf 'SLACK_BOT_TOKEN=%s\n' "$B1" > "$H/.claude/channels/oldbot/.env"
printf '# codex rules\nBe careful.\n' > "$H/.codex/AGENTS.md"
printf 'model = "x"\napi_key = "%s"\n' "$B2" > "$H/.codex/config.toml"
SRC_FILES="$H/.claude/CLAUDE.md $H/.claude/agents/reviewer.md $H/.claude/channels/oldbot/$SOUL $H/.claude/channels/oldbot/.env $H/.codex/AGENTS.md $H/.codex/config.toml"
src_fp() { for f in $SRC_FILES; do printf '%s %s\n' "$f" "$(sha_of "$f")"; done; }
FP_BEFORE="$(src_fp)"
python3 -I - "$T/answers.json" <<'PY'
import json, sys
json.dump({'schema': 1, 'mode': 'full', 'mux': 'auto',
           'slack': {'enabled': True, 'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'guests': []},
           'wiki': {'path': None}, 'mcp': [], 'codex': False, 'doctor': True, 'browser': 'none', 'memory': 'later',
           'bots': [{'name': 'alpha', 'role': 'lead', 'source': 'role-default'},
                    {'name': 'bravo', 'role': 'watch', 'source': 'role-default'},
                    {'name': 'charlie', 'role': 'research', 'source': 'role-default'},
                    {'name': 'oldbot', 'role': 'custom', 'source': 'import'}],
           'import': {'from': ['claude-md:global', 'agent:reviewer', 'bot:oldbot', 'codex-agents:global'], 'to': None}},
          open(sys.argv[1], 'w'), indent=2)
PY
# ── the one real run ──
python3 -I - "$TREE" "$H" "$T/answers.json" "$T/live.out" "$T/live.meta" <<'PY'
import os, signal, subprocess, sys, time
tree, home, answers, out, meta = sys.argv[1:6]
env = {'HOME': home, 'PATH': os.environ['PATH'], 'SHELL': '/bin/zsh', 'TERM': 'dumb', 'MODS_SETUP_NO_OPEN': '1', 'MODS_SETUP_REPO': tree,
       'ANTHROPIC_BASE_URL': os.environ['ANTHROPIC_BASE_URL'], 'ANTHROPIC_AUTH_TOKEN': os.environ['ANTHROPIC_AUTH_TOKEN'],
       'CLAUDE_CODE_DISABLE_AUTOUPDATER': '1', 'DISABLE_AUTOUPDATER': '1'}
cmd = ['claude', '-p', '/mods-setup:setup --answers ' + answers, '--plugin-dir', tree + '/setup',
       '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,Skill']
t0 = time.time()
p = subprocess.Popen(cmd, cwd=tree, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
try:
    so, se = p.communicate(timeout=1500)
    rc = p.returncode
except subprocess.TimeoutExpired:
    try: os.killpg(p.pid, signal.SIGKILL)
    except OSError: pass
    so, se = p.communicate()
    rc, se = 124, (se or '') + '\nTIMEOUT'
leak = bool(env['ANTHROPIC_AUTH_TOKEN']) and env['ANTHROPIC_AUTH_TOKEN'] in (so + se)
open(out, 'w').write(so + ('\n--- stderr ---\n' + se if se.strip() else ''))
open(meta, 'w').write('rc=%d secs=%d relay_token_in_output=%s\n' % (rc, time.time() - t0, leak))
PY
cat "$T/live.meta"
RUN_RC="$(sed -n 's/^rc=\([0-9]*\) .*/\1/p' "$T/live.meta")"
[ "$RUN_RC" = 0 ] && ok "claude -p exited 0" || no "claude -p rc=$RUN_RC (see live.out)"
grep -q 'relay_token_in_output=False' "$T/live.meta" && ok "the relay token value is not in the run's output" || no "relay token leaked into the output"
SJ="$H/.slackmod/setup.json"
[ "$(python3 -I -c 'import json,sys; print([b["name"] for b in json.load(open(sys.argv[1]))["bots"]])' "$SJ" 2>/dev/null)" = "['alpha', 'bravo', 'charlie', 'oldbot']" ] \
  && ok "setup.json written by the wizard with the four bots" || no "setup.json missing or bots differ"
# ── G3 · copies only ──
imp="$(ls -d "$H"/.slackmod/import/*/ 2>/dev/null | head -1)"
[ -n "$imp" ] && [ -f "${imp}MANIFEST.txt" ] && [ -f "${imp}claude/CLAUDE.md" ] && [ -f "${imp}bots/oldbot/$SOUL" ] && [ -f "$H/bots/oldbot/$SOUL" ] \
  && ok "G3 copies: ~/.slackmod/import/<time>/ + MANIFEST · CLAUDE.md copy · the old bot's file copied and placed in its new folder" || no "G3 import copies missing"
[ "$(src_fp)" = "$FP_BEFORE" ] && ok "G3 originals byte-identical ($(echo "$SRC_FILES" | wc -w | tr -d ' ') planted files: sha256 before = after)" || no "G3 an original changed"
leak="$(grep -rl 'BAITBAITBAIT' "$H/.slackmod" "$H/bots" "$T/live.out" 2>/dev/null | wc -l | tr -d ' ')"
[ "$leak" = 0 ] && ok "G3 bait secrets in 0 files (install · copies · bot folders · model output)" || no "G3 bait leaked into $leak file(s)"
# ── G3 · three role defaults · G4 · filled persona + pre-install check ──
for pair in alpha:lead bravo:watch charlie:research; do
  b="${pair%%:*}"; r="${pair##*:}"; d="$H/bots/$b"
  if [ -f "$d/persona.md" ] && [ -f "$d/CLAUDE.md" ] && grep -qE "^role: *$r\$" "$d/persona.md"; then ok "G3 role default «$r» → $b: persona.md + CLAUDE.md (role: $r)"
  else no "G3 role default «$r» → $b: persona.md/CLAUDE.md missing or role line ≠ $r"; fi
  if grep -q 'generated: bot-interview' "$d/persona.md" 2>/dev/null && grep -qE "^name: *$b\$" "$d/persona.md"; then ok "G4 $b persona.md filled (fill mark + name: $b)"
  else no "G4 $b persona.md not filled from the skeleton (mark or name missing)"; fi
  python3 -I "$TREE/setup/lib/persona-check.py" "$d" > "$T/check-$b.txt" 2>&1; prc=$?
  [ $prc -eq 0 ] && ok "G4 persona-check $b rc 0 · $(grep '^결과:' "$T/check-$b.txt" | tail -1)" || no "G4 persona-check $b rc $prc · $(grep -m1 '^걸림' "$T/check-$b.txt")"
done
# the check must bite on these very files (bait pair on a copy — never on the bot folder itself)
N="$T/neg"; mkdir -p "$N"; cp -R "$H/bots/alpha" "$N/secret"; cp -R "$H/bots/alpha" "$N/stub"
printf '\n- 연락용 %s\n' "$B1" >> "$N/secret/persona.md"
printf '\n- 이름표 <BOT_NAME>\n' >> "$N/stub/persona.md"
python3 -I "$TREE/setup/lib/persona-check.py" "$N/secret" > "$T/check-neg-secret.txt" 2>&1; s1=$?
python3 -I "$TREE/setup/lib/persona-check.py" "$N/stub" > "$T/check-neg-stub.txt" 2>&1; s2=$?
[ $s1 -eq 1 ] && grep -q '^걸림 · 비밀값' "$T/check-neg-secret.txt" && ! grep -q 'BAITBAITBAIT' "$T/check-neg-secret.txt" \
  && ok "G4 bait: planted token shape → rc 1 «걸림 · 비밀값» (value not printed)" || no "G4 bait secret: rc $s1 · $(head -1 "$T/check-neg-secret.txt")"
[ $s2 -eq 1 ] && grep -q '^걸림 · 자리표시자' "$T/check-neg-stub.txt" \
  && ok "G4 bait: left-over <BOT_NAME> → rc 1 «걸림 · 자리표시자»" || no "G4 bait stub: rc $s2 · $(head -1 "$T/check-neg-stub.txt")"
# ── G2 · doctor summary has no blank cell · installer idempotent ──
env -i HOME="$H" PATH="$PATH" SHELL=/bin/zsh "$BASHX" "$TREE/setup/lib/doctor.sh" > "$T/doctor.txt" 2>&1
sum="$(grep '^요약:' "$T/doctor.txt" | tail -1)"
tot="$(printf '%s' "$sum" | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')"
[ "$tot" = 12 ] && ok "G2 doctor «$sum» = 12 cells (no blank cell)" || no "G2 doctor summary «$sum» counts $tot cells (want 12)"
OUT="$(env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm --plan "$SJ" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(printf '%s' "$OUT" | grep -o '바뀜 [0-9]*' | tail -1)" = "바뀜 0" ] && ok "a second install.sh --plan: 바뀜 0" || no "second --plan rc=$rc $(printf '%s' "$OUT" | grep -o '바뀜 [0-9]*' | tail -1)"
for pat in '원본 지문 전후' '결과: 통과' '요약:' 'OPEN '; do
  grep -q -- "$pat" "$T/live.out" && echo "SIGNAL ok «${pat}» appears in the run's output" || echo "SIGNAL missing «$pat» in the run's output (soft)"
done
finish
