#!/usr/bin/env bash
# m1-root-install.sh — the public entry <root>/install.sh: checks the base (OS · shell · claude · node 20+ · python3 · git · one window tool),
# shows only the install lines for what is missing (never installs, never sudo), then starts the wizard inside Claude Code.
#   ① all present → --no-launch rc 0 ② each missing piece → rc 3 + its own install line (mac: brew · linux: apt) and no other line
#   ③ node 18 = missing · nvm node found · ~/.local/bin/claude found ④ any ONE of tmux/cmux/herdr is enough
#   ⑤ launch = exec claude --plugin-dir <root>/setup "/mods-setup:setup [--answers abs] [--section x]" with MODS_SETUP_REPO set
#   ⑥ both layouts (public: slackmod/ · dev: port/) ⑦ input errors rc 2 · unsupported OS rc 3 ⑧ HOME is never written
#   bash setup/tests/m1-root-install.sh [path/to/root/install.sh]       Fake tools only (no real claude · no network). rc 0 = all PASS.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
ROOT_INSTALL="${1:-$REPO_ROOT/install.sh}"
T="$(mk_tmp m1-root)"
trap 'rm -rf "$T"' EXIT
# --- trees: public layout (slackmod/) and dev layout (port/) ---
mk_tree() { # mk_tree <dir> pub|dev
  local d="$1"
  mkdir -p "$d"; cp "$ROOT_INSTALL" "$d/install.sh"; chmod 755 "$d/install.sh"
  mkdir -p "$d/setup"; cp -R "$SETUP_DIR/.claude-plugin" "$d/setup/"
  if [ "$2" = pub ]; then make_bundle "$d/slackmod"; else mkdir -p "$d/port"; cp -R "$PORT_DIR"/. "$d/port/"; fi
}
mk_tree "$T/pub" pub; mk_tree "$T/dev" dev
# --- fake tool dir: only system utilities the script needs + the fakes a scenario asks for ---
SYS="env bash sh grep awk sed ls sort tail head basename dirname cat tr cut mkdir rm cp mv date stat wc"
fake() { printf '%s\n' "$2" > "$1"; chmod 755 "$1"; }   # fake <file> <script text>
mk_tools() { # mk_tools <dir> [tool…] — tools: claude node22 node18 python3 git tmux cmux herdr curl brew uname-linux uname-mingw (default uname = Darwin)
  local d="$1"; shift
  rm -rf "$d"; mkdir -p "$d"
  local s
  for s in $SYS; do ln -s "$(command -v "$s")" "$d/$s"; done
  fake "$d/uname" '#!/bin/sh
echo Darwin'
  for s in "$@"; do
    case "$s" in
      claude) fake "$d/claude" '#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.309 (Claude Code)"; exit 0; fi
{ printf "ARGC=%s\n" "$#"; for a in "$@"; do printf "ARG=%s\n" "$a"; done; printf "REPO=%s\n" "${MODS_SETUP_REPO:-}"; } > "$CLAUDE_LOG"' ;;
      node22) fake "$d/node" '#!/bin/sh
echo 22' ;;
      node18) fake "$d/node" '#!/bin/sh
echo 18' ;;
      python3|git|tmux|cmux|herdr|curl|brew) fake "$d/$s" '#!/bin/sh
exit 0' ;;
      uname-linux) fake "$d/uname" '#!/bin/sh
echo Linux' ;;
      uname-mingw) fake "$d/uname" '#!/bin/sh
echo MINGW64_NT-10.0' ;;
    esac
  done
}
# run_root <tree> <tools dir> [args…] → OUT · RC  (HOME = fresh empty dir · SHELL=/bin/zsh)
run_root() {
  local tree="$1" tools="$2"; shift 2
  HOME_T="$T/home.$RANDOM"; mkdir -p "$HOME_T"
  CLAUDE_LOG="$T/claude.log.$RANDOM"; export CLAUDE_LOG; rm -f "$CLAUDE_LOG"
  OUT="$(env -i HOME="$HOME_T" SHELL=/bin/zsh PATH="$tools" CLAUDE_LOG="$CLAUDE_LOG" "$BASHX" "$tree/install.sh" "$@" 2>&1)"; RC=$?
}
ALL="claude node22 python3 git tmux"

# ① all present
mk_tools "$T/t1" $ALL
run_root "$T/pub" "$T/t1" --no-launch
[ $RC -eq 0 ] && printf '%s' "$OUT" | grep -q '바탕 점검 통과' && [ ! -f "$CLAUDE_LOG" ] && [ -z "$(ls -A "$HOME_T")" ] \
  && ok "① all present: --no-launch rc 0 · «바탕 점검 통과» · claude not started · HOME untouched" || { no "① rc=$RC"; printf '%s\n' "$OUT" | tail -8; }
printf '%s' "$OUT" | grep -q 'claude   .*2.1.309' && printf '%s' "$OUT" | grep -q 'node     .* 22' && ok "①b the report names claude version 2.1.309 · node 22" || no "①b report lines"
# ② each missing piece (mac wording first = this host) → rc 3 · its own line · no other piece's line
miss_case() { # miss_case <label> <tools…> -- <want regex> <must-not regex> [uname-linux]
  local label="$1"; shift
  local tools=(); while [ "$1" != "--" ]; do tools+=("$1"); shift; done; shift
  local want="$1" not="$2"; shift 2
  mk_tools "$T/tm" ${tools[@]+"${tools[@]}"} "$@"
  run_root "$T/pub" "$T/tm" --no-launch
  if [ $RC -eq 3 ] && printf '%s' "$OUT" | grep -qE "$want" && ! printf '%s' "$OUT" | grep -qE "$not" && [ -z "$(ls -A "$HOME_T")" ]; then
    ok "② $label → rc 3 · «$(printf '%s' "$OUT" | grep -E "$want" | head -1 | sed 's/^ *//')»"
  else no "② $label rc=$RC (want /$want/ · must not /$not/)"; printf '%s\n' "$OUT" | tail -8; fi
}
miss_case "git missing (mac)"      claude node22 python3 tmux brew -- 'brew install git$'               'nvm|claude.ai/install|brew install .*(python|tmux)'
miss_case "python3 missing (mac)"  claude node22 git tmux brew -- 'brew install python$'                'nvm|claude.ai/install|brew install .*(git|tmux)'
miss_case "window tool missing (mac)" claude node22 python3 git brew -- 'brew install tmux$'            'nvm|claude.ai/install|brew install .*(git|python)'
miss_case "node missing"           claude python3 git tmux -- 'nvm install 22'                     'brew install|claude.ai/install'
miss_case "node 18 is too old"     claude node18 python3 git tmux -- 'node 20 이상 \(지금 18\)'      'brew install|claude.ai/install'
miss_case "claude missing"         node22 python3 git tmux -- 'claude.ai/install.sh \| bash'       'brew install|nvm install'
miss_case "git missing (linux)"    claude node22 python3 tmux curl uname-linux -- 'sudo apt-get update && sudo apt-get install -y git ca-certificates' 'brew|nvm|claude.ai/install'
miss_case "curl + git missing (linux)" claude node22 python3 tmux uname-linux -- 'apt-get install -y git curl ca-certificates' 'brew|nvm|claude.ai/install'
miss_case "everything missing"     -- 'brew install .*python.*git.*tmux' 'zzzzzz'
printf '%s' "$OUT" | grep -q 'nvm install 22' && printf '%s' "$OUT" | grep -q 'claude.ai/install.sh' && ok "②b everything missing: sudo-free lines for node and claude are listed too" || no "②b everything-missing lines"
# ③ nvm node found without node on PATH · ~/.local/bin/claude found
mk_tools "$T/t3" python3 git tmux claude
HOME_T="$T/home.nvm"; mkdir -p "$HOME_T/.nvm/versions/node/v22.3.0/bin" "$HOME_T/.nvm/versions/node/v18.0.0/bin"
printf '#!/bin/sh\necho 22\n' > "$HOME_T/.nvm/versions/node/v22.3.0/bin/node"; printf '#!/bin/sh\necho 18\n' > "$HOME_T/.nvm/versions/node/v18.0.0/bin/node"
chmod 755 "$HOME_T"/.nvm/versions/node/*/bin/node
OUT="$(env -i HOME="$HOME_T" SHELL=/bin/zsh PATH="$T/t3" "$BASHX" "$T/pub/install.sh" --no-launch 2>&1)"; RC=$?
[ $RC -eq 0 ] && printf '%s' "$OUT" | grep -q 'v22.3.0/bin/node' && ok "③ nvm: newest node (v22.3.0) found without node on PATH → rc 0" || { no "③ nvm rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
mk_tools "$T/t3b" python3 git tmux node22
HOME_T="$T/home.lb"; mkdir -p "$HOME_T/.local/bin"; printf '#!/bin/sh\necho "2.1.296 (Claude Code)"\n' > "$HOME_T/.local/bin/claude"; chmod 755 "$HOME_T/.local/bin/claude"
OUT="$(env -i HOME="$HOME_T" SHELL=/bin/zsh PATH="$T/t3b" "$BASHX" "$T/pub/install.sh" --no-launch 2>&1)"; RC=$?
[ $RC -eq 0 ] && printf '%s' "$OUT" | grep -q '\.local/bin/claude' && ok "③b claude only in ~/.local/bin → found (rc 0)" || { no "③b rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
# ④ any one window tool is enough
for w in tmux cmux herdr; do
  mk_tools "$T/t4" claude node22 python3 git "$w"
  run_root "$T/pub" "$T/t4" --no-launch
  [ $RC -eq 0 ] && printf '%s' "$OUT" | grep -q "창 도구  $w" && ok "④ only $w present → rc 0 · listed" || { no "④ only $w rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
done
# ⑤ launch: both layouts, plain · --answers · --section · both
for lay in pub dev; do
  mk_tools "$T/t5" $ALL
  run_root "$T/$lay" "$T/t5"
  want_plugin="$T/$lay/setup"
  # the script resolves its own folder with pwd -P — compare against the physical path
  phys="$(cd "$T/$lay" && pwd -P)"
  if [ $RC -eq 0 ] && grep -qx 'ARG=--plugin-dir' "$CLAUDE_LOG" && grep -qx "ARG=$phys/setup" "$CLAUDE_LOG" && grep -qx 'ARG=/mods-setup:setup' "$CLAUDE_LOG" \
     && grep -qx 'ARGC=3' "$CLAUDE_LOG" && grep -qx "REPO=$phys" "$CLAUDE_LOG"; then
    ok "⑤ launch ($lay layout): exec claude --plugin-dir <root>/setup \"/mods-setup:setup\" · 3 args · MODS_SETUP_REPO=<root>"
  else no "⑤ launch $lay rc=$RC"; cat "$CLAUDE_LOG" 2>/dev/null; printf '%s\n' "$OUT" | tail -4; fi
done
printf '{"schema":1}\n' > "$T/answers one.json"
mk_tools "$T/t5" $ALL
run_root "$T/pub" "$T/t5" --answers "$T/answers one.json"
physT="$(cd "$T" && pwd -P)"
grep -qx "ARG=/mods-setup:setup --answers $physT/answers one.json" "$CLAUDE_LOG" 2>/dev/null && ok "⑤b --answers FILE (path with a space): passed on as one absolute prompt argument" || { no "⑤b --answers"; cat "$CLAUDE_LOG" 2>/dev/null; }
run_root "$T/pub" "$T/t5" --section slack
grep -qx 'ARG=/mods-setup:setup --section slack' "$CLAUDE_LOG" 2>/dev/null && ok "⑤c --section slack: passed on" || { no "⑤c --section"; cat "$CLAUDE_LOG" 2>/dev/null; }
cd "$T" && printf '{"schema":1}\n' > rel.json && run_root "$T/pub" "$T/t5" --answers rel.json --section wiki
grep -qx "ARG=/mods-setup:setup --answers $physT/rel.json --section wiki" "$CLAUDE_LOG" 2>/dev/null && ok "⑤d relative --answers path made absolute · both options together" || { no "⑤d relative"; cat "$CLAUDE_LOG" 2>/dev/null; }
cd "$REPO_ROOT"
# ⑥ missing piece blocks the launch (claude not started)
mk_tools "$T/t6" claude node22 python3 tmux
run_root "$T/pub" "$T/t6"
[ $RC -eq 3 ] && [ ! -f "$CLAUDE_LOG" ] && ok "⑥ a missing piece (git) blocks the launch: rc 3 · claude never started" || { no "⑥ rc=$RC"; }
# ⑦ input errors · unsupported OS
mk_tools "$T/t7" $ALL
run_root "$T/pub" "$T/t7" --answers "$T/nope.json" --no-launch
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q 'answers' && ok "⑦a --answers file missing → rc 2" || no "⑦a rc=$RC"
run_root "$T/pub" "$T/t7" --section "Bad Name" --no-launch
[ $RC -eq 2 ] && ok "⑦b --section «Bad Name» → rc 2" || no "⑦b rc=$RC"
run_root "$T/pub" "$T/t7" --bogus
[ $RC -eq 2 ] && ok "⑦c unknown option → rc 2" || no "⑦c rc=$RC"
mk_tree "$T/noplug" pub; rm -rf "$T/noplug/setup/.claude-plugin"
run_root "$T/noplug" "$T/t7" --no-launch
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q '플러그인' && ok "⑦d no setup/.claude-plugin → rc 2" || no "⑦d rc=$RC"
mk_tree "$T/noinst" pub; rm -rf "$T/noinst/slackmod"
run_root "$T/noinst" "$T/t7" --no-launch
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q '설치 본체' && ok "⑦e neither slackmod/ nor port/ → rc 2" || no "⑦e rc=$RC"
mk_tools "$T/t7m" $ALL uname-mingw
run_root "$T/pub" "$T/t7m" --no-launch
[ $RC -eq 3 ] && printf '%s' "$OUT" | grep -q 'WSL' && ok "⑦f unsupported OS (MINGW) → rc 3 · says WSL" || { no "⑦f rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑧ the script itself writes nothing in the tree either
before="$(listing "$T/pub")"; mk_tools "$T/t8" $ALL; run_root "$T/pub" "$T/t8" --no-launch
[ "$(listing "$T/pub")" = "$before" ] && ok "⑧ the checkout is unchanged after a run (writes 0)" || no "⑧ tree changed"
finish
