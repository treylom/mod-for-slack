#!/usr/bin/env bash
# m2-detect-import.sh — detect.sh / import.sh against a FAKE ~/.claude · ~/.codex · bot (never the real ones):
#   detect: read only (fingerprint of everything before = after) · every item kind found · no secret printed · broken files noted
#   import: dry-run writes 0 · copies land in the import folder AND the bot folders · originals' fingerprint before = after ·
#           secret-shaped names/contents refused (bait strings appear NOWHERE in copies or output) · settings = allow/deny/ask only ·
#           never overwrites (different file there = kept + reported) · twice = 사본 0 · broken target settings = rc 2 untouched
#   bash setup/tests/m2-detect-import.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m2-import)"
trap 'rm -rf "$T"' EXIT
DET="$SETUP_DIR/lib/detect.sh"; IMP="$SETUP_DIR/lib/import.sh"
B1="xoxb-""111111111111-222222222222-BAITBAITBAITBAITBAIT"      # bait 1: bot token shape
B2="sk-""BAITBAITBAITBAITBAITBAIT"                                # bait 2: api key shape
B3="ghp_""BAITBAITBAITBAITBAITBAITBAIT"                           # bait 3: github token shape
B4="-----BEGIN ""RSA PRIVATE KEY-----"                            # bait 4: private key header
BAITS="BAITBAITBAIT"
SOUL="so""ul.md"   # an older tool's persona file name — assembled so this file stays clean of our internal names
HN=0
mk_fake_home() { # → H : a fake home with the foreign setups
  HN=$((HN + 1)); H="$T/home$HN"; mkdir -p "$H"
  mkdir -p "$H/.claude/agents" "$H/.claude/skills/note/refs" "$H/.claude/channels/oldbot" "$H/.codex" "$H/prev/.claude/agents" "$H/.slackmod" "$H/bots/lead" "$H/bots/oldbot" "$H/bots/prevbot"
  printf '# global rules\nAlways answer short.\n' > "$H/.claude/CLAUDE.md"
  printf -- '---\nname: reviewer\n---\nReview code.\n' > "$H/.claude/agents/reviewer.md"
  printf -- '---\nname: planner\n---\nPlan work.\n' > "$H/.claude/agents/planner.md"
  printf -- '---\nname: note\n---\nTake notes.\n' > "$H/.claude/skills/note/SKILL.md"
  printf 'reference a\n' > "$H/.claude/skills/note/refs/a.md"
  printf 'API=%s\n' "$B2" > "$H/.claude/skills/note/.env"
  printf '{"token":"%s"}\n' "$B1" > "$H/.claude/skills/note/credentials.json"
  printf 'key: %s\n' "$B3" > "$H/.claude/skills/note/refs/leak.md"
  ln -s "$H/.claude/CLAUDE.md" "$H/.claude/skills/note/refs/link.md"
  python3 -I - "$H" "$B1" "$B2" <<'PY'
import json, sys
h, b1, b2 = sys.argv[1:4]
json.dump({'env': {'ANTHROPIC_AUTH_TOKEN': b1}, 'hooks': {'PreToolUse': [{'matcher': '*', 'hooks': [{'type': 'command', 'command': 'echo hi'}]}]},
           'permissions': {'allow': ['Bash(ls:*)', 'Read(~/wiki/**)', 'Bash(curl -H "Authorization: Bearer %s")' % b2], 'deny': ['Bash(rm:*)'], 'defaultMode': 'bypassPermissions'}},
          open(h + '/.claude/settings.json', 'w'), indent=2)
json.dump({'bots': [{'name': 'prevbot', 'work_dir': h + '/prev'}], 'slack': {'channel_id': 'x'}}, open(h + '/.slackmod/config.json', 'w'))
PY
  printf '# old soul\nI am the old bot.\n' > "$H/.claude/channels/oldbot/$SOUL"
  printf 'SLACK_BOT_TOKEN=%s\n' "$B1" > "$H/.claude/channels/oldbot/.env"
  printf '# codex rules\nBe careful.\n' > "$H/.codex/AGENTS.md"
  printf 'model = "x"\napi_key = "%s"\n' "$B2" > "$H/.codex/config.toml"
  printf '# prev claude\n' > "$H/prev/CLAUDE.md"; printf '# prev agents\n' > "$H/prev/AGENTS.md"
  printf 'prev agent\n' > "$H/prev/.claude/agents/pa.md"
  printf '{"permissions":{"allow":["Bash(git status)"]},"env":{"X":"%s"}}\n' "$B1" > "$H/prev/.claude/settings.json"
}
fp_sources() { ( cd "$1" && listing .claude && listing .codex && listing prev && listing .slackmod ) 2>/dev/null; }   # (listing = path · mode · sha per file)
SRC_DIRS_LISTING() { for d in .claude .codex prev; do ( cd "$H" && find "$d" -mindepth 0 | LC_ALL=C sort | while IFS= read -r f; do if [ -f "$f" ] && [ ! -L "$f" ]; then printf '%s %s\n' "$f" "$(sha_of "$f")"; else printf '%s\n' "$f"; fi; done ); done; }

# ── detect ──
mk_fake_home
before="$(SRC_DIRS_LISTING; listing "$H" | wc -l)"
"$BASHX" "$DET" --home "$H" > "$T/det.json" 2> "$T/det.err"; rc=$?
after="$(SRC_DIRS_LISTING; listing "$H" | wc -l)"
ids="$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(" ".join(sorted(i["id"] for i in d["items"])))' "$T/det.json")"
WANT="agent:planner agent:reviewer bot:oldbot claude-md:global codex-agents:global codex-config:global settings:permissions skill:note slackmod-bot:prevbot slackmod-config:previous"
[ $rc -eq 0 ] && [ "$ids" = "$WANT" ] && ok "detect: rc 0 · all 10 item kinds found ($ids)" || { no "detect rc=$rc ids=$ids"; cat "$T/det.err"; }
[ "$before" = "$after" ] && ok "detect: read only — fingerprint of ~/.claude · ~/.codex · prev + HOME listing size unchanged" || no "detect changed something"
! grep -q "$BAITS" "$T/det.json" && ok "detect: no bait/secret text in the JSON output" || no "detect leaked a bait"
det="$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); s=[i for i in d["items"] if i["id"]=="settings:permissions"][0]; print(s["detail"])' "$T/det.json")"
[ "$det" = "allow 2 · deny 1 · 비밀 꼴 1 제외" ] && ok "detect: settings detail = counts only («${det}»; the secret-shaped allow entry is not counted in)" || no "detect settings detail: $det"
home_json="$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["home"])' "$T/det.json")"
[ "$home_json" = "$H" ] && grep -q '"path": "~/.claude/CLAUDE.md"' "$T/det.json" && ok "detect: paths shown with ~ · home echoed" || no "detect paths"
# empty home · broken settings
EH="$T/empty"; mkdir -p "$EH"
out="$("$BASHX" "$DET" --home "$EH" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(printf '%s' "$out" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["count"])')" = 0 ] && [ -z "$(ls -A "$EH")" ] && ok "detect: empty home → rc 0 · count 0 · nothing created" || no "detect empty rc=$rc"
BH="$T/broken"; mkdir -p "$BH/.claude"; printf '{bad' > "$BH/.claude/settings.json"; printf '{"bots": 3' > /dev/null
out="$("$BASHX" "$DET" --home "$BH" 2>&1)"; rc=$?
[ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'not valid JSON' && ok "detect: broken settings.json → listed under skipped (rc 0)" || { no "detect broken rc=$rc"; printf '%s\n' "$out" | tail -4; }

# ── import: dry-run ──
mk_fake_home
BOTS=(--bot "lead:$H/bots/lead" --bot "oldbot:$H/bots/oldbot" --bot "prevbot:$H/bots/prevbot")
ALLIDS="claude-md:global,agent:reviewer,agent:planner,skill:note,settings:permissions,codex-agents:global,codex-config:global,bot:oldbot,slackmod-bot:prevbot,slackmod-config:previous"
TO="$T/import-dest"
before="$(listing "$H")"; "$BASHX" "$IMP" --home "$H" --from "$ALLIDS" "${BOTS[@]}" --to "$TO" --dry-run > "$T/dry.out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(listing "$H")" = "$before" ] && [ ! -e "$TO" ] && grep -q '^할 일' "$T/dry.out" && grep -q '원본 지문 전후: 같음' "$T/dry.out" \
  && ok "import --dry-run: rc 0 · HOME listing unchanged · import folder not made · plans shown · fingerprint line" || { no "import dry-run rc=$rc"; tail -5 "$T/dry.out"; }
# ── import: real ──
SRC_BEFORE="$(SRC_DIRS_LISTING)"
"$BASHX" "$IMP" --home "$H" --from "$ALLIDS" "${BOTS[@]}" --to "$TO" > "$T/imp.out" 2>&1; rc=$?
SRC_AFTER="$(SRC_DIRS_LISTING)"
[ $rc -eq 0 ] && grep -q '원본 지문 전후: 같음' "$T/imp.out" && [ "$SRC_BEFORE" = "$SRC_AFTER" ] \
  && ok "import: rc 0 · «원본 지문 전후: 같음» printed AND an outside listing of ~/.claude · ~/.codex · prev (paths+sha) is identical before/after" || { no "import rc=$rc"; tail -6 "$T/imp.out"; }
miss=""
for f in claude/CLAUDE.md claude/agents/reviewer.md claude/agents/planner.md claude/skills/note/SKILL.md claude/skills/note/refs/a.md claude/settings.permissions.json codex/AGENTS.md bots/oldbot/$SOUL bots/prevbot/CLAUDE.md bots/prevbot/AGENTS.md bots/prevbot/.claude/agents/pa.md slackmod/config.json MANIFEST.txt; do
  [ -f "$TO/$f" ] || miss="$miss $f"
done
[ -z "$miss" ] && ok "import: the import folder has every expected copy (13 files incl. MANIFEST.txt)" || no "import folder missing:$miss"
bad=""
for f in claude/skills/note/.env claude/skills/note/credentials.json claude/skills/note/refs/leak.md claude/skills/note/refs/link.md codex/config.toml bots/oldbot/.env; do [ -e "$TO/$f" ] && bad="$bad $f"; done
[ -z "$bad" ] && grep -c '^거부' "$T/imp.out" | grep -qx 4 && ok "import: 4 refused (.env · credentials.json · token-shaped leak.md · codex config.toml with a key) · the symlink skipped · none of them copied" || { no "import refusals: copied:$bad refused-lines=$(grep -c '^거부' "$T/imp.out")"; grep '^거부' "$T/imp.out"; }
leak="$(grep -rl "$BAITS" "$TO" "$H/bots" "$T/imp.out" "$T/dry.out" 2>/dev/null | wc -l | tr -d ' ')"
[ "$leak" = 0 ] && ok "import: bait strings (token · key · github · PEM shapes) appear in 0 files of the import folder · bot folders · output" || { no "import leaked $leak files"; grep -rl "$BAITS" "$TO" "$H/bots" "$T/imp.out" 2>/dev/null; }
perm="$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sorted(d), sorted(d["permissions"]), d["permissions"]["allow"], d["permissions"]["deny"])' "$TO/claude/settings.permissions.json")"
[ "$perm" = "['permissions'] ['allow', 'deny'] ['Bash(ls:*)', 'Read(~/wiki/**)'] ['Bash(rm:*)']" ] && ok "import: settings copy = permissions allow/deny only (no env · hooks · defaultMode · the secret-shaped allow entry dropped)" || no "import settings copy: $perm"
# the bot folders
lead="$H/bots/lead"
[ -f "$lead/CLAUDE.md" ] && [ -f "$lead/AGENTS.md" ] && [ -f "$lead/.claude/agents/reviewer.md" ] && [ -f "$lead/.claude/skills/note/refs/a.md" ] && [ ! -e "$lead/.claude/skills/note/.env" ] \
  && [ "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["permissions"]["allow"])' "$lead/.claude/settings.json")" = "['Bash(ls:*)', 'Read(~/wiki/**)']" ] \
  && ok "import: bot «lead» (project scope) got CLAUDE.md · AGENTS.md · agents · skill (no .env) · merged allow list" || no "import lead folder"
[ "$(cat "$H/bots/oldbot/$SOUL")" = "$(cat "$H/.claude/channels/oldbot/$SOUL")" ] && [ ! -e "$H/bots/oldbot/.env" ] && ok "import: old bot's $SOUL copied unchanged (same name) into «oldbot» · its .env not" || no "import oldbot"
pv="$H/bots/prevbot"
[ "$(cat "$pv/CLAUDE.md")" = "# prev claude" ] && [ -f "$pv/.claude/agents/pa.md" ] && [ -f "$pv/.claude/agents/reviewer.md" ] \
  && [ "$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["permissions"]["allow"], "env" in d)' "$pv/.claude/settings.json")" = "['Bash(git status)', 'Bash(ls:*)', 'Read(~/wiki/**)'] False" ] && [ -f "$pv/.claude/imported/CLAUDE.md" ] \
  && ok "import: earlier bot «prevbot»: its own CLAUDE.md kept first · global CLAUDE.md went to .claude/imported/ · permissions unioned (own entry first) · its env NOT carried" || { no "import prevbot"; cat "$pv/.claude/settings.json" 2>/dev/null; }
# twice = 사본 0 (same --to), nothing changes
before="$(listing "$H")"
"$BASHX" "$IMP" --home "$H" --from "$ALLIDS" "${BOTS[@]}" --to "$TO" > "$T/imp2.out" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q '결과: 사본 0 ' "$T/imp2.out" && [ "$(listing "$H")" = "$before" ] && ok "import again (same --to): 사본 0 · HOME listing unchanged · rc 0" || { no "import again rc=$rc"; grep -E '^(사본|오류|그대로)' "$T/imp2.out" | head; tail -3 "$T/imp2.out"; }
# the default import folder is ~/.slackmod/import/<time>
mk_fake_home
"$BASHX" "$IMP" --home "$H" --from claude-md:global --bot "lead:$H/bots/lead" > "$T/imp3.out" 2>&1; rc=$?
n="$(find "$H/.slackmod/import" -name CLAUDE.md 2>/dev/null | wc -l | tr -d ' ')"
[ $rc -eq 0 ] && [ "$n" = 1 ] && find "$H/.slackmod/import" -maxdepth 1 -mindepth 1 | grep -qE '/[0-9]{8}-[0-9]{6}$' && ok "import without --to: ~/.slackmod/import/<YYYYMMDD-HHMMSS>/ made · 1 copy" || { no "import default folder rc=$rc n=$n"; tail -3 "$T/imp3.out"; }
# never overwrites: a different file already in the bot folder stays, the global CLAUDE.md goes to .claude/imported/
mk_fake_home
printf 'MY OWN BOT RULES\n' > "$H/bots/lead/CLAUDE.md"; mkdir -p "$H/bots/lead/.claude/agents"; printf 'my reviewer\n' > "$H/bots/lead/.claude/agents/reviewer.md"
"$BASHX" "$IMP" --home "$H" --from claude-md:global,agent:reviewer --bot "lead:$H/bots/lead" --to "$T/ow" > "$T/imp4.out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(cat "$H/bots/lead/CLAUDE.md")" = "MY OWN BOT RULES" ] && [ "$(cat "$H/bots/lead/.claude/agents/reviewer.md")" = "my reviewer" ] \
  && [ -f "$H/bots/lead/.claude/imported/CLAUDE.md" ] && grep -q '^그대로.*reviewer.md' "$T/imp4.out" \
  && ok "import: existing CLAUDE.md / agent file stay as they were · the global CLAUDE.md goes to .claude/imported/ · the kept agent file is reported" || { no "import no-overwrite rc=$rc"; cat "$T/imp4.out"; }
# a broken settings.json in the target bot → rc 2, untouched (other copies still done)
mk_fake_home; mkdir -p "$H/bots/lead/.claude"; printf '{bad' > "$H/bots/lead/.claude/settings.json"
"$BASHX" "$IMP" --home "$H" --from settings:permissions,agent:reviewer --bot "lead:$H/bots/lead" --to "$T/bk" > "$T/imp5.out" 2>&1; rc=$?
[ $rc -eq 2 ] && [ "$(cat "$H/bots/lead/.claude/settings.json")" = "{bad" ] && grep -q '^오류' "$T/imp5.out" && ok "import: broken target settings.json → rc 2 · file untouched · 오류 line (other copies still made)" || { no "import broken target rc=$rc"; cat "$T/imp5.out"; }
# input errors
mk_fake_home
"$BASHX" "$IMP" --home "$H" --from nope:x > /dev/null 2> "$T/e1"; r1=$?
"$BASHX" "$IMP" --home "$H" > /dev/null 2> "$T/e2"; r2=$?
"$BASHX" "$IMP" --home "$H" --from claude-md:global --bot "Bad:/x" > /dev/null 2> "$T/e3"; r3=$?
"$BASHX" "$IMP" --home "$H" --from claude-md:global --bot "lead:relative" > /dev/null 2> "$T/e4"; r4=$?
"$BASHX" "$IMP" --home "$H" --from claude-md:global --bot "lead:/a" --bot "lead:/b" > /dev/null 2> "$T/e5"; r5=$?
[ $r1 -eq 2 ] && [ $r2 -eq 2 ] && [ $r3 -eq 2 ] && [ $r4 -eq 2 ] && [ $r5 -eq 2 ] && [ ! -e "$H/.slackmod/import" ] && ok "import: unknown id · no --from · bad bot name · relative dir · duplicate bot → rc 2 each · nothing made" || no "import input errors rc $r1 $r2 $r3 $r4 $r5"
# a bot item with no matching target → copied to the import folder only + a note
mk_fake_home
out="$("$BASHX" "$IMP" --home "$H" --from bot:oldbot --bot "lead:$H/bots/lead" --to "$T/nt" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ -f "$T/nt/bots/oldbot/$SOUL" ] && [ ! -e "$H/bots/lead/$SOUL" ] && printf '%s' "$out" | grep -q '^안내' && ok "import: a bot item without a matching target bot → import folder only · 안내 line" || no "import no-target rc=$rc"
out="$("$BASHX" "$IMP" --home "$H" --from bot:oldbot --bot "lead:$H/bots/lead" --map bot:oldbot=lead --to "$T/nt2" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ -f "$H/bots/lead/$SOUL" ] && ok "import: --map bot:oldbot=lead sends it to «lead»" || no "import --map rc=$rc"

# ── import: a destination folder pre-made as a SYMLINK must not carry a write out of the folder the person picked (security review, item 5) ──
# (every part of a destination below the picked root — the bot's work folder, or the import folder — must be a real folder/file:
#  a symlink on the way = refused with one 오류 line, rc 2, nothing written through it · the rest of the import carries on)
sym_import() { # LABEL LINK(relative to the bot folder · "" = none) IDS [more import args…] → $OUT (the outside folder) · $SYM_RC · $SYM_SRC_SAME · $T/sym-LABEL.out
  local label="$1" link="$2" ids="$3"; shift 3
  mk_fake_home; OUT="$T/outside-$label"; mkdir -p "$OUT"
  printf -- '---\nname: probe\n---\nProbe.\n' > "$H/.claude/agents/probe.md"
  if [ -n "$link" ]; then mkdir -p "$(dirname "$H/bots/lead/$link")"; ln -s "$OUT" "$H/bots/lead/$link"; fi
  SYM_BEFORE="$(SRC_DIRS_LISTING)"
  "$BASHX" "$IMP" --home "$H" --from "$ids" --bot "lead:$H/bots/lead" --to "$T/to-$label" "$@" > "$T/sym-$label.out" 2>&1; SYM_RC=$?
  SYM_SRC_SAME=no; [ "$SYM_BEFORE" = "$(SRC_DIRS_LISTING)" ] && SYM_SRC_SAME=yes
}
# the reviewer's reproduction: work/.claude/agents -> outside, then import an agent
sym_import agents .claude/agents agent:probe
[ $SYM_RC -eq 2 ] && [ -z "$(ls -A "$OUT")" ] && [ -L "$H/bots/lead/.claude/agents" ] && [ "$SYM_SRC_SAME" = yes ] && [ -f "$T/to-agents/claude/agents/probe.md" ] \
  && grep -q '^오류' "$T/sym-agents.out" && grep -q '원본 지문 전후: 같음' "$T/sym-agents.out" \
  && ok "import: bot/.claude/agents -> outside folder → rc 2 · 오류 line · outside stays empty · symlink kept · originals unchanged · the import-folder copy still made" \
  || { no "import through a symlinked .claude/agents: rc=$SYM_RC outside=[$(ls -A "$OUT")] src_same=$SYM_SRC_SAME"; cat "$T/sym-agents.out"; }
sym_import skills .claude/skills skill:note
[ $SYM_RC -eq 2 ] && [ -z "$(ls -A "$OUT")" ] && [ "$SYM_SRC_SAME" = yes ] && grep -q '^오류' "$T/sym-skills.out" \
  && ok "import: bot/.claude/skills -> outside folder → rc 2 · outside stays empty (a whole skill tree is refused)" || { no "import through a symlinked .claude/skills: rc=$SYM_RC outside=[$(ls -A "$OUT")]"; cat "$T/sym-skills.out"; }
sym_import dotclaude .claude agent:probe,skill:note,settings:permissions
[ $SYM_RC -eq 2 ] && [ -z "$(ls -A "$OUT")" ] && [ "$SYM_SRC_SAME" = yes ] && grep -q '^오류' "$T/sym-dotclaude.out" \
  && ok "import: bot/.claude itself -> outside folder → rc 2 · outside stays empty (agent · skill · settings merge all refused)" || { no "import through a symlinked .claude: rc=$SYM_RC outside=[$(ls -A "$OUT")]"; cat "$T/sym-dotclaude.out"; }
# the permissions file itself is a symlink to a file outside → the merge must not write through it
mk_fake_home; OUT="$T/outside-settings"; mkdir -p "$OUT" "$H/bots/lead/.claude"
printf '{"permissions":{"allow":["Keep"]}}\n' > "$OUT/s.json"; ln -s "$OUT/s.json" "$H/bots/lead/.claude/settings.json"
want="$(sha_of "$OUT/s.json")"
"$BASHX" "$IMP" --home "$H" --from settings:permissions --bot "lead:$H/bots/lead" --to "$T/to-settings" > "$T/sym-settings.out" 2>&1; rc=$?
[ $rc -eq 2 ] && [ "$(sha_of "$OUT/s.json")" = "$want" ] && [ -L "$H/bots/lead/.claude/settings.json" ] && grep -q '^오류' "$T/sym-settings.out" \
  && ok "import: bot/.claude/settings.json -> a file outside → rc 2 · that file is byte-identical (the allow-list merge does not write through the link)" || { no "import through a symlinked settings.json: rc=$rc"; cat "$T/sym-settings.out"; }
# the import folder (--to reused) with a symlinked sub folder
mk_fake_home; OUT="$T/outside-to"; mkdir -p "$OUT" "$T/to-reuse/claude"; ln -s "$OUT" "$T/to-reuse/claude/agents"
printf -- '---\nname: probe\n---\nProbe.\n' > "$H/.claude/agents/probe.md"
"$BASHX" "$IMP" --home "$H" --from agent:probe --to "$T/to-reuse" > "$T/sym-to.out" 2>&1; rc=$?
[ $rc -eq 2 ] && [ -z "$(ls -A "$OUT")" ] && grep -q '^오류' "$T/sym-to.out" \
  && ok "import: --to folder with claude/agents -> outside folder → rc 2 · outside stays empty" || { no "import into a --to folder with a symlinked sub folder: rc=$rc outside=[$(ls -A "$OUT")]"; cat "$T/sym-to.out"; }
# MANIFEST.txt of a reused --to folder is a symlink to a file outside → not written through
mk_fake_home; OUT="$T/outside-mani"; mkdir -p "$OUT" "$T/to-mani"; printf 'keep\n' > "$OUT/m.txt"; ln -s "$OUT/m.txt" "$T/to-mani/MANIFEST.txt"
printf -- '---\nname: probe\n---\nProbe.\n' > "$H/.claude/agents/probe.md"
"$BASHX" "$IMP" --home "$H" --from agent:probe --to "$T/to-mani" > "$T/sym-mani.out" 2>&1; rc=$?
[ $rc -eq 2 ] && [ "$(cat "$OUT/m.txt")" = keep ] && grep -q '^오류' "$T/sym-mani.out" \
  && ok "import: --to folder's MANIFEST.txt -> a file outside → rc 2 · that file unchanged" || { no "import with a symlinked MANIFEST.txt: rc=$rc"; cat "$T/sym-mani.out"; }
# an EXISTING identical file seen through a symlink is only read, never written → still «same», no error (the old behaviour stays)
mk_fake_home; OUT="$T/outside-same"; mkdir -p "$OUT"; cp "$H/.claude/CLAUDE.md" "$OUT/CLAUDE.md"; ln -s "$OUT/CLAUDE.md" "$H/bots/lead/CLAUDE.md"
"$BASHX" "$IMP" --home "$H" --from claude-md:global --bot "lead:$H/bots/lead" --to "$T/to-same" > "$T/sym-same.out" 2>&1; rc=$?
[ $rc -eq 0 ] && ! grep -q '^오류' "$T/sym-same.out" && [ -L "$H/bots/lead/CLAUDE.md" ] && [ "$(ls -A "$OUT")" = CLAUDE.md ] \
  && ok "import: a symlinked CLAUDE.md that already has the same bytes → rc 0 · no 오류 (nothing is written, so nothing to refuse)" || { no "import with an identical symlinked CLAUDE.md: rc=$rc"; cat "$T/sym-same.out"; }
# a dry-run says so too (and plans nothing for that place)
sym_import dry .claude/agents agent:probe --dry-run
[ $SYM_RC -eq 2 ] && [ -z "$(ls -A "$OUT")" ] && grep -q '^오류' "$T/sym-dry.out" && ! grep -q '^할 일.*bots/lead' "$T/sym-dry.out" && [ ! -e "$T/to-dry" ] \
  && ok "import --dry-run: the symlinked destination is reported as 오류 (rc 2) · no plan line for it · nothing written" || { no "import --dry-run symlinked destination: rc=$SYM_RC"; cat "$T/sym-dry.out"; }
# the normal path stays: real pre-made folders → copied · the bot folder given THROUGH a symlinked path (the picked root itself may be one) → copied
sym_import normal "" agent:probe
[ $SYM_RC -eq 0 ] && [ -f "$H/bots/lead/.claude/agents/probe.md" ] && [ -f "$T/to-normal/claude/agents/probe.md" ] && ! grep -q '^오류' "$T/sym-normal.out" \
  && ok "import: no symlink anywhere → rc 0 · copied into the bot folder and the import folder as before" || { no "import normal path: rc=$SYM_RC"; cat "$T/sym-normal.out"; }
mk_fake_home; mkdir -p "$H/bots/lead/.claude/agents"
printf -- '---\nname: probe\n---\nProbe.\n' > "$H/.claude/agents/probe.md"
"$BASHX" "$IMP" --home "$H" --from agent:probe --bot "lead:$H/bots/lead" --to "$T/to-premade" > "$T/sym-premade.out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ -f "$H/bots/lead/.claude/agents/probe.md" ] && ! grep -q '^오류' "$T/sym-premade.out" \
  && ok "import: a real pre-made .claude/agents folder → rc 0 · copied as before" || { no "import into a real pre-made folder: rc=$rc"; cat "$T/sym-premade.out"; }
mk_fake_home; ln -s "$H/bots/lead" "$H/bots/lead-link"
printf -- '---\nname: probe\n---\nProbe.\n' > "$H/.claude/agents/probe.md"
"$BASHX" "$IMP" --home "$H" --from agent:probe --bot "lead:$H/bots/lead-link" --to "$T/to-rootlink" > "$T/sym-rootlink.out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ -f "$H/bots/lead/.claude/agents/probe.md" ] && ! grep -q '^오류' "$T/sym-rootlink.out" \
  && ok "import: the picked bot folder itself reached through a symlinked path → still fine (only what is BELOW the picked folder is checked)" || { no "import via a symlinked bot-folder path: rc=$rc"; cat "$T/sym-rootlink.out"; }
finish
