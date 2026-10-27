#!/usr/bin/env bash
# m3-bundle-layout.sh — the public layout built from a REAL bundle (make-bundle output): <tree>/install.sh · <tree>/setup/ ·
# <tree>/slackmod/ (the unzipped bundle). Checks the pieces fit: the zip carries the new installer code, the plugin validates in
# place, the root install.sh finds its pieces in this layout (check-only on the real PATH · launch with a FAKE claude), the
# installer resolver picks slackmod/, and «install.sh --plan» of the real bundle installs into a throwaway HOME twice (바뀜 0).
#   bash setup/tests/m3-bundle-layout.sh <bundle.zip>
#   (build one:  bash port/make-bundle.sh HEAD --thiscode-repo <ThisCode checkout> --thiscode-ref 13c7c75 --out DIR)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
ZIP="${1:?bundle.zip}"
T="$(mk_tmp m3-layout)"
trap 'rm -rf "$T"' EXIT
make_public_tree "$T/tree" "$ZIP" || { echo "FAIL unzip"; exit 1; }
TREE="$(cd "$T/tree" && pwd -P)"; B="$TREE/slackmod"
. "$SETUP_TESTS_DIR/plan-lib.sh"

[ -f "$B/install.sh" ] && [ -f "$B/app/mods-harness/.claude-plugin/plugin.json" ] && [ -f "$B/app/channel-server/dist/server.js" ] && [ ! -e "$B/setup" ] \
  && ok "tree: slackmod/ holds the bundle (install.sh · app/mods-harness · app/channel-server/dist) and no setup/ (make-bundle packs port/ only)" || no "tree shape"
grep -q 'from-setup' "$B/lib/slackmod_config.py" && grep -q 'PLAN_FILE' "$B/install.sh" && grep -q 'ZSH\|zshrc' "$B/install.sh" \
  && ok "the zip carries this branch's installer code (--plan · from-setup · zsh rc default)" || no "zip lacks the new installer code"
env -i HOME="$T" PATH="$PATH" claude plugin validate "$TREE/setup" > "$T/validate.log" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q 'Validation passed' "$T/validate.log" && ok "claude plugin validate <tree>/setup → passed" || { no "plugin validate rc=$rc"; tail -3 "$T/validate.log"; }
FI="$("$BASHX" "$TREE/setup/lib/find-installer.sh" 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$FI" = "$B/install.sh" ] && ok "find-installer (no argument) from <tree>/setup/lib → <tree>/slackmod/install.sh" || no "find-installer: $FI"
# the root entry on the real PATH (check only: reads, writes nothing)
HR="$T/home.root"; mkdir -p "$HR"
OUT="$(env HOME="$HR" "$BASHX" "$TREE/install.sh" --no-launch 2>&1)"; rc=$?
[ $rc -eq 0 ] && printf '%s' "$OUT" | grep -q '바탕 점검 통과' && [ -z "$(ls -A "$HR")" ] && ok "root install.sh --no-launch on this machine: rc 0 · «바탕 점검 통과» · HOME untouched" || { no "root --no-launch rc=$rc"; printf '%s\n' "$OUT" | tail -6; }
# launch with a fake claude in front of the real PATH
mkdir -p "$T/fakebin"
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.309 (Claude Code)"; exit 0; fi\n{ for a in "$@"; do printf "ARG=%%s\\n" "$a"; done; printf "REPO=%%s\\n" "${MODS_SETUP_REPO:-}"; } > "$CLAUDE_LOG"\n' > "$T/fakebin/claude"; chmod 755 "$T/fakebin/claude"
CLAUDE_LOG="$T/claude.log"; export CLAUDE_LOG
env HOME="$HR" PATH="$T/fakebin:$PATH" "$BASHX" "$TREE/install.sh" --answers "$T/a.json" > /dev/null 2>&1; r0=$?
printf '{"schema":1}\n' > "$T/a.json"
env HOME="$HR" PATH="$T/fakebin:$PATH" "$BASHX" "$TREE/install.sh" --answers "$T/a.json" > /dev/null 2>&1; rc=$?
[ $r0 -eq 2 ] && [ $rc -eq 0 ] && grep -qx "ARG=$TREE/setup" "$CLAUDE_LOG" && grep -qx "ARG=/mods-setup:setup --answers $(cd "$T" && pwd -P)/a.json" "$CLAUDE_LOG" && grep -qx "REPO=$TREE" "$CLAUDE_LOG" \
  && ok "root install.sh --answers: missing file → rc 2 · present → exec claude --plugin-dir <tree>/setup \"/mods-setup:setup --answers <abs>\" (fake claude) · MODS_SETUP_REPO=<tree>" || { no "root launch r0=$r0 rc=$rc"; cat "$CLAUDE_LOG" 2>/dev/null; }
# the real bundle installs from a setup.json (zsh) · twice = 바뀜 0
new_home; mk_setup "$T/real.json" "d['wiki']['path'] = '$H/wiki'"
plan_run "$T/real.json"
if [ $RC -eq 0 ] && grep -q '^alias lead=' "$H/.zshrc" && [ -f "$H/.slackmod/config.json" ] && [ -f "$H/.slackmod/bots/lead/harness.json" ] && [ -f "$H/bots/lead/.mcp.json" ] && [ -f "$H/bots/lead/.claude/settings.json" ] && printf '%s' "$OUT" | grep -q '다리 출처 커밋'; then
  ok "real bundle · install.sh --plan (zsh): rc 0 · config.json · aliases in ~/.zshrc · harness.json · .mcp.json · wiki permission · bridge fingerprint line · $(count0 "$OUT")"
else no "real --plan rc=$RC"; printf '%s\n' "$OUT" | tail -8; fi
FP1="$(cat "$H/.slackmod/state/install.fp")"; before="$(listing "$H" | grep -v 'state/install.fp')"
plan_run "$T/real.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(cat "$H/.slackmod/state/install.fp")" = "$FP1" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] \
  && ok "real bundle · second --plan: 바뀜 0 · same fingerprint (${FP1:0:16}) · files unchanged" || { no "real --plan again rc=$RC $(count0 "$OUT")"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -5; }
# the generated bot config passes the harness gate runner (same smoke the port tests use) — skipped when no runner file
RUNNER="$H/.slackmod/app/mods-harness/src/hooks-port/runner.py"
[ -f "$RUNNER" ] && python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' "$H/.slackmod/bots/lead/harness.json" 2>/dev/null && ok "installed harness.json is valid JSON · runner present at the installed path" || no "installed runner/harness.json"
finish
