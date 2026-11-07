#!/usr/bin/env bash
# m3-live-wizard.sh — ONE real model run of the wizard: «claude -p --plugin-dir <tree>/setup "/mods-setup:setup --answers FILE"»
# in a throwaway HOME (fake ~/.claude · ~/.codex · an older bot, with bait secrets) on the public layout built from a real bundle.
# Auth = the two relay variables (ANTHROPIC_BASE_URL · ANTHROPIC_AUTH_TOKEN) handed to the child process through its environment
# (never on a command line, never printed). The terminal step runs with MODS_SETUP_NO_OPEN=1 — no window is ever opened.
# Then it checks what REALLY happened on disk (install.sh --plan ran: config · aliases · bot folders · import copies · wiki/browser
# files), that the bait appears nowhere in copies or in the model's output, that the originals are byte-identical, and that a
# second «install.sh --plan» of the result says 바뀜 0. Costs one model session. rc 0 = all hard checks PASS.
#   bash setup/tests/m3-live-wizard.sh <bundle.zip> [evidence-output-file]
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
ZIP="${1:?bundle.zip}"; EVID="${2:-}"
[ -n "${ANTHROPIC_BASE_URL:-}" ] && [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || { echo "FAIL the relay variables ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN are not in this environment"; exit 2; }
T="$(mk_tmp m3-live)"
trap 'rm -rf "$T"' EXIT
make_public_tree "$T/tree" "$ZIP" || { echo "FAIL unzip"; exit 1; }
TREE="$(cd "$T/tree" && pwd -P)"; B="$TREE/slackmod"
H="$T/home"; mkdir -p "$H"
SOUL="so""ul.md"
B1="xoxb-""111111111111-222222222222-BAITBAITBAITBAITBAIT"; B2="sk-""BAITBAITBAITBAITBAITBAIT"; B3="ghp_""BAITBAITBAITBAITBAITBAITBAIT"
# fake foreign setups (benign text — the live claude also reads them as its own user files)
mkdir -p "$H/.claude/agents" "$H/.claude/skills/note/refs" "$H/.claude/channels/oldbot" "$H/.codex" "$H/wiki/notes"
printf '# my notes\nI like tea.\n' > "$H/.claude/CLAUDE.md"
printf -- '---\nname: reviewer\ndescription: reviews code\n---\nReview code.\n' > "$H/.claude/agents/reviewer.md"
printf -- '---\nname: note\ndescription: take notes\n---\nTake notes.\n' > "$H/.claude/skills/note/SKILL.md"
printf 'reference a\n' > "$H/.claude/skills/note/refs/a.md"
printf 'API=%s\n' "$B2" > "$H/.claude/skills/note/.env"
printf 'key: %s\n' "$B3" > "$H/.claude/skills/note/refs/leak.md"
printf '{"permissions":{"allow":["Bash(ls:*)","Bash(curl -H \\"Authorization: Bearer %s\\")"]}}\n' "$B2" > "$H/.claude/settings.json"
printf '# old bot\nI am the old bot.\n' > "$H/.claude/channels/oldbot/$SOUL"
printf 'SLACK_BOT_TOKEN=%s\n' "$B1" > "$H/.claude/channels/oldbot/.env"
printf '# codex rules\nBe careful.\n' > "$H/.codex/AGENTS.md"
printf 'model = "x"\napi_key = "%s"\n' "$B2" > "$H/.codex/config.toml"
printf 'a wiki note\n' > "$H/wiki/notes/one.md"
SRC_FILES="$H/.claude/CLAUDE.md $H/.claude/agents/reviewer.md $H/.claude/skills/note/SKILL.md $H/.claude/skills/note/refs/a.md $H/.claude/skills/note/.env $H/.claude/skills/note/refs/leak.md $H/.claude/settings.json $H/.claude/channels/oldbot/$SOUL $H/.claude/channels/oldbot/.env $H/.codex/AGENTS.md $H/.codex/config.toml"
src_fp() { for f in $SRC_FILES; do printf '%s %s\n' "$f" "$(sha_of "$f")"; done; }
FP_BEFORE="$(src_fp)"
python3 -I - "$T/answers.json" "$H" <<'PY'
import json, sys
f, h = sys.argv[1:3]
json.dump({'schema': 1, 'mode': 'full', 'mux': 'auto',
           'slack': {'enabled': True, 'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'guests': ['UGUESTAAA01']},
           'wiki': {'path': h + '/wiki'}, 'mcp': ['wiki-search'], 'codex': False, 'doctor': True, 'browser': 'playwright', 'memory': 'later',
           'bots': [{'name': 'lead', 'role': 'lead', 'source': 'role-default'}, {'name': 'oldbot', 'role': 'custom', 'source': 'import'}],
           'import': {'from': ['claude-md:global', 'agent:reviewer', 'skill:note', 'settings:permissions', 'bot:oldbot', 'codex-agents:global', 'codex-config:global'], 'to': None}},
          open(f, 'w'), indent=2)
PY
# ── the one real run (python subprocess: the relay values travel in the child's environment only) ──
python3 -I - "$TREE" "$H" "$T/answers.json" "$T/live.out" "$T/live.meta" <<'PY'
import os, signal, subprocess, sys, time
tree, home, answers, out, meta = sys.argv[1:6]
env = {'HOME': home, 'PATH': os.environ['PATH'], 'SHELL': '/bin/zsh', 'TERM': 'dumb', 'MODS_SETUP_NO_OPEN': '1', 'MODS_SETUP_REPO': tree,
       'ANTHROPIC_BASE_URL': os.environ['ANTHROPIC_BASE_URL'], 'ANTHROPIC_AUTH_TOKEN': os.environ['ANTHROPIC_AUTH_TOKEN'],
       'CLAUDE_CODE_DISABLE_AUTOUPDATER': '1', 'DISABLE_AUTOUPDATER': '1'}
# the prompt comes FIRST: --allowedTools takes a variable number of values and would swallow a prompt placed after it (run #1 of the
# first attempt lost its prompt that way) · stdin is closed so the child never waits on input
cmd = ['claude', '-p', '/mods-setup:setup --answers ' + answers, '--plugin-dir', tree + '/setup',
       '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,Skill']
t0 = time.time()
p = subprocess.Popen(cmd, cwd=tree, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
try:
    so, se = p.communicate(timeout=1200)
    rc = p.returncode
except subprocess.TimeoutExpired:
    try: os.killpg(p.pid, signal.SIGKILL)   # the whole process group (claude + the tools it started)
    except OSError: pass
    so, se = p.communicate()
    rc, se = 124, (se or '') + '\nTIMEOUT'
secrets = [v for k, v in env.items() if k == 'ANTHROPIC_AUTH_TOKEN' and v]
leak = any(s in (so + se) for s in secrets)
open(out, 'w').write(so + ('\n--- stderr ---\n' + se if se.strip() else ''))
open(meta, 'w').write('rc=%d secs=%d relay_token_in_output=%s\n' % (rc, time.time() - t0, leak))
PY
cat "$T/live.meta"
[ -n "$EVID" ] && cp "$T/live.out" "$EVID"
RUN_RC="$(sed -n 's/^rc=\([0-9]*\) .*/\1/p' "$T/live.meta")"
# ── what really happened ──
[ "$RUN_RC" = 0 ] && ok "claude -p exited 0" || no "claude -p rc=$RUN_RC (see the evidence file)"
grep -q 'relay_token_in_output=False' "$T/live.meta" && ok "the relay token value is not in the run's output" || no "relay token leaked into the output"
SJ="$H/.slackmod/setup.json"
python3 -I "$SETUP_DIR/lib/plan.py" "$SJ" --home "$H" > "$T/plan.chk" 2>&1; prc=$?
[ -f "$SJ" ] && [ $prc -eq 0 ] && [ "$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print([b["name"] for b in d["bots"]], d["browser"], d["slack"]["guests"])' "$SJ")" = "['lead', 'oldbot'] playwright ['UGUESTAAA01']" ] \
  && ok "~/.slackmod/setup.json written by the wizard · passes plan.py (bots lead + oldbot · playwright · guest kept)" || { no "setup.json ($prc)"; cat "$T/plan.chk" 2>/dev/null | head -3; }
[ -f "$H/.slackmod/config.json" ] && grep -q '^alias lead=' "$H/.zshrc" 2>/dev/null && grep -q '^alias oldbot=' "$H/.zshrc" && [ -f "$H/.slackmod/bots/lead/harness.json" ] && [ -f "$H/.slackmod/bots/oldbot/slack/.env" ] \
  && ok "install.sh --plan really ran: config.json · aliases in the temp ~/.zshrc · harness.json + .env per bot" || no "install result missing (config/aliases/bots)"
grep -qx 'ALLOWED_SLACK_GUEST_IDS=UGUESTAAA01' "$H/.slackmod/bots/lead/slack/.env" 2>/dev/null && ok "guest id reached the bot .env (ALLOWED_SLACK_GUEST_IDS)" || no "guest id missing in .env"
[ "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["mcpServers"]["playwright"]["args"][1])' "$H/bots/lead/.mcp.json" 2>/dev/null)" = "@playwright/mcp@0.0.83" ] && [ -f "$H/bots/oldbot/.mcp.json" ] \
  && [ "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["permissions"]["additionalDirectories"])' "$H/bots/lead/.claude/settings.json" 2>/dev/null)" = "['$H/wiki']" ] \
  && ok "browser + wiki columns applied: .mcp.json (pinned playwright) and .claude/settings.json additionalDirectories = [wiki] in the bot folders" || no "wiki/browser files"
imp="$(ls -d "$H"/.slackmod/import/*/ 2>/dev/null | head -1)"
[ -n "$imp" ] && [ -f "${imp}MANIFEST.txt" ] && [ -f "${imp}claude/CLAUDE.md" ] && [ -f "${imp}bots/oldbot/$SOUL" ] && [ -f "$H/bots/oldbot/$SOUL" ] && [ -f "$H/bots/lead/.claude/agents/reviewer.md" ] \
  && ok "import copies exist: ~/.slackmod/import/<time>/ (+MANIFEST) · old bot's persona file in its new bot folder · agent in the lead folder" || no "import copies missing"
leak="$(grep -rl 'BAITBAITBAIT' "$H/.slackmod" "$H/bots" "$T/live.out" 2>/dev/null | wc -l | tr -d ' ')"
[ "$leak" = 0 ] && ok "bait secrets (token · key · github shapes) appear in 0 files of the install, the copies, the bot folders and the model's output" || { no "bait leaked into $leak file(s)"; grep -rl 'BAITBAITBAIT' "$H/.slackmod" "$H/bots" "$T/live.out" 2>/dev/null | sed "s#$H#~#"; }
[ "$(src_fp)" = "$FP_BEFORE" ] && ok "originals byte-identical after the run ($(echo "$SRC_FILES" | wc -w | tr -d ' ') planted source files: sha256 before = after)" || no "an original changed"
OUT="$(env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm --plan "$SJ" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(printf '%s' "$OUT" | grep -o '바뀜 [0-9]*' | tail -1)" = "바뀜 0" ] && ok "a second install.sh --plan of the wizard's setup.json: 바뀜 0" || { no "second --plan rc=$rc $(printf '%s' "$OUT" | grep -o '바뀜 [0-9]*' | tail -1)"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -5; }
# soft signals from the model's own report (not hard: wording is the model's)
for pat in '결과: 바뀜' 'OPEN ' '원본 지문 전후' '건너뜀'; do
  grep -q -- "$pat" "$T/live.out" && echo "SIGNAL ok «${pat}» appears in the run's output" || echo "SIGNAL missing «${pat}» in the run's output (soft)"
done
finish
