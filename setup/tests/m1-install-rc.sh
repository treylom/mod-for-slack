#!/usr/bin/env bash
# m1-install-rc.sh — port/install.sh puts the «켜기 이름» (aliases) into the right shell rc file for the person's shell.
#   ① SHELL=/bin/zsh (macOS default) → ~/.zshrc gets the managed block · ~/.bashrc is not created   ← RED before the fix
#   ② SHELL=/bin/bash → ~/.bashrc · no ~/.zshrc  ③ SHELL empty → ~/.bashrc  ④ --rc FILE wins over SHELL
#   ⑤ install twice = «바뀜 0» (zsh)  ⑥ a real zsh that sources the file really has the alias
#   bash setup/tests/m1-install-rc.sh [path/to/install.sh]     (default: port/install.sh of this repo)
# Works in throwaway HOMEs only. Never starts a bot. rc 0 = all PASS.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
INSTALL_SRC="${1:-$PORT_DIR/install.sh}"
T="$(mk_tmp m1-rc)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/port-copy"; cp -R "$PORT_DIR"/. "$T/port-copy/"; cp "$INSTALL_SRC" "$T/port-copy/install.sh"
B="$T/bundle"; make_bundle "$B" "$T/port-copy"

# one_install <label> <SHELL value (may be empty)> [extra install args…] → makes $T/<label>/home, installs twice (config copy → fill → apply)
# (bash fills in SHELL itself when it is unset — so «unset» is tested as an empty SHELL)
one_install() {
  local label="$1" sh="$2"; shift 2
  H="$T/$label/home"; mkdir -p "$H"
  env SHELL="$sh" HOME="$H" "$BASHX" "$B/install.sh" --no-npm "$@" > "$T/$label.1.log" 2>&1
  fill_config "$H"
  env SHELL="$sh" HOME="$H" "$BASHX" "$B/install.sh" --no-npm "$@" > "$T/$label.2.log" 2>&1; RC_APPLY=$?
}

# ① zsh (the macOS default)
one_install zsh /bin/zsh
if [ "$RC_APPLY" -eq 0 ] && grep -q '^alias chonggwal=' "$H/.zshrc" 2>/dev/null && [ ! -e "$H/.bashrc" ]; then
  ok "① SHELL=/bin/zsh → aliases in ~/.zshrc (alias lines $(grep -c '^alias ' "$H/.zshrc")) · no ~/.bashrc"
else no "① SHELL=/bin/zsh: rc=$RC_APPLY · zshrc alias lines $(grep -c '^alias ' "$H/.zshrc" 2>/dev/null || echo 0) · bashrc exists $([ -e "$H/.bashrc" ] && echo yes || echo no)"; tail -3 "$T/zsh.2.log"; fi
ZH="$H"
# ② bash
one_install bash /bin/bash
[ "$RC_APPLY" -eq 0 ] && grep -q '^alias chonggwal=' "$H/.bashrc" 2>/dev/null && [ ! -e "$H/.zshrc" ] \
  && ok "② SHELL=/bin/bash → ~/.bashrc · no ~/.zshrc" || no "② SHELL=/bin/bash rc=$RC_APPLY"
# ③ SHELL empty
one_install unset ""
[ "$RC_APPLY" -eq 0 ] && grep -q '^alias chonggwal=' "$H/.bashrc" 2>/dev/null && [ ! -e "$H/.zshrc" ] \
  && ok "③ SHELL empty → ~/.bashrc · no ~/.zshrc" || no "③ SHELL empty rc=$RC_APPLY"
# ④ --rc wins
mkdir -p "$T/custom"
one_install rcflag /bin/zsh --rc "$T/custom/myrc"
[ "$RC_APPLY" -eq 0 ] && grep -q '^alias chonggwal=' "$T/custom/myrc" 2>/dev/null && [ ! -e "$H/.zshrc" ] && [ ! -e "$H/.bashrc" ] \
  && ok "④ --rc FILE wins over SHELL=zsh (no ~/.zshrc · no ~/.bashrc)" || no "④ --rc rc=$RC_APPLY"
# ⑤ twice = 바뀜 0 (zsh)
H="$ZH"
out="$(env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm 2>&1)"; rc=$?
printf '%s' "$out" | grep -q '바뀜 0 ·' && [ $rc -eq 0 ] && ok "⑤ second install (zsh) = 바뀜 0" || { no "⑤ second install rc=$rc"; printf '%s\n' "$out" | grep -v 그대로 | tail -5; }
# ⑥ a real zsh sources the file → the alias exists
al="$(env HOME="$H" zsh -f -c ". '$H/.zshrc'; alias chonggwal" 2>&1)"
printf '%s' "$al" | grep -q "slackmod open chonggwal" && ok "⑥ zsh sources ~/.zshrc → «${al}»" || no "⑥ zsh alias: $al"
finish
