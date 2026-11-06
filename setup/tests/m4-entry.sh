#!/usr/bin/env bash
# m4-entry.sh — stage-1 entry: ① no Claude Code → «Claude Code 가 없습니다 — 먼저 설치하고 오세요» line + README pointer + the official
# one-liner, rc 3, wizard not started ② a Windows shell (Git Bash under PowerShell · MINGW/MSYS) → the WSL guide, rc 3 ③ --resume
# → claude gets «/mods-setup:setup --resume» ④ --resume with --section / --answers → rc 2 ⑤ open-terminal.sh --continue <bot>
# (dry-run) names the bot's folder and «--resume», writes nothing, works before the bot is installed · the old token window is
# unchanged ⑥ HOME is never written by the entry.
#   bash setup/tests/m4-entry.sh        fake tools only (no real claude · no network) · rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m4-entry)"
trap 'rm -rf "$T"' EXIT
TREE="$T/pub"
mkdir -p "$TREE/setup"; cp "$REPO_ROOT/install.sh" "$TREE/install.sh"; cp -R "$SETUP_DIR/.claude-plugin" "$TREE/setup/"
make_bundle "$TREE/slackmod"
SYS="env bash sh grep awk sed ls sort tail head basename dirname cat tr cut mkdir rm cp mv date stat wc"
fake() { printf '%s\n' "$2" > "$1"; chmod 755 "$1"; }
mk_tools() { # mk_tools <dir> <uname> [tool…]
  local d="$1" un="$2" s; shift 2
  rm -rf "$d"; mkdir -p "$d"
  for s in $SYS; do ln -s "$(command -v "$s")" "$d/$s"; done
  fake "$d/uname" "#!/bin/sh
echo $un"
  for s in "$@"; do
    case "$s" in
      claude) fake "$d/claude" '#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.312 (Claude Code)"; exit 0; fi
{ for a in "$@"; do printf "ARG=%s\n" "$a"; done; } > "$CLAUDE_LOG"' ;;
      node22) fake "$d/node" '#!/bin/sh
echo 22' ;;
      *) fake "$d/$s" '#!/bin/sh
exit 0' ;;
    esac
  done
}
run_root() { # run_root <tools> [args…] → OUT RC HOME_T
  local tools="$1"; shift
  HOME_T="$T/home.$RANDOM"; mkdir -p "$HOME_T"
  CLAUDE_LOG="$T/claude.log.$RANDOM"; rm -f "$CLAUDE_LOG"
  OUT="$(env -i HOME="$HOME_T" SHELL=/bin/zsh PATH="$tools" CLAUDE_LOG="$CLAUDE_LOG" "$BASHX" "$TREE/install.sh" "$@" 2>&1)"; RC=$?
}
has() { printf '%s\n' "$OUT" | grep -qF -- "$1"; }

# ① no claude (mac)
mk_tools "$T/t1" Darwin node22 python3 git tmux
run_root "$T/t1"
[ "$RC" = 3 ] && ok "① no claude → rc 3" || no "① no claude rc=$RC"
has "[Claude Code 가 없습니다 — 먼저 설치하고 오세요]" && ok "① easy-installer line" || no "① easy-installer line missing"
has "README.md 의 «Claude Code 먼저 깔기» 절" && ok "① README pointer" || no "① README pointer missing"
has "curl -fsSL https://claude.ai/install.sh | bash" && ok "① official one-liner" || no "① official one-liner missing"
[ ! -f "$CLAUDE_LOG" ] && ok "① wizard not started" || no "① wizard started without claude"
[ -z "$(ls -A "$HOME_T")" ] && ok "① HOME untouched" || no "① HOME written"
# ①b positive pair: claude present → no easy-installer line, wizard starts
mk_tools "$T/t1b" Darwin claude node22 python3 git tmux
run_root "$T/t1b"
[ "$RC" = 0 ] && ok "①b claude present → rc 0" || no "①b rc=$RC: $(printf '%s' "$OUT" | tail -3)"
has "Claude Code 가 없습니다" && no "①b easy-installer line shown though claude exists" || ok "①b no easy-installer line"
grep -qx 'ARG=/mods-setup:setup' "$CLAUDE_LOG" 2>/dev/null && ok "①b wizard prompt plain" || no "①b wizard prompt: $(cat "$CLAUDE_LOG" 2>/dev/null)"

# ② Windows shells
for un in MINGW64_NT-10.0-19045 MSYS_NT-10.0 CYGWIN_NT-10.0; do
  mk_tools "$T/t2" "$un" claude node22 python3 git tmux
  run_root "$T/t2"
  [ "$RC" = 3 ] && has "윈도우 안의 리눅스(WSL · Ubuntu)" && has "«Claude Code 먼저 깔기»" && [ ! -f "$CLAUDE_LOG" ] \
    && ok "② $un → WSL guide rc 3" || no "② $un rc=$RC: $(printf '%s' "$OUT" | head -3)"
done
mk_tools "$T/t2b" FreeBSD claude node22 python3 git tmux
run_root "$T/t2b"
[ "$RC" = 3 ] && ! has "윈도우 안의 리눅스" && ok "② other OS → plain unsupported line (no Windows text)" || no "② FreeBSD rc=$RC"

# ③ --resume
mk_tools "$T/t3" Darwin claude node22 python3 git tmux
run_root "$T/t3" --resume
[ "$RC" = 0 ] && grep -qx 'ARG=/mods-setup:setup --resume' "$CLAUDE_LOG" 2>/dev/null && ok "③ --resume → wizard --resume" || no "③ rc=$RC log=$(cat "$CLAUDE_LOG" 2>/dev/null)"
# ④ conflicts
run_root "$T/t3" --resume --section slack
[ "$RC" = 2 ] && [ ! -f "$CLAUDE_LOG" ] && ok "④ --resume + --section → rc 2" || no "④ rc=$RC"
printf '{}' > "$T/a.json"
run_root "$T/t3" --resume --answers "$T/a.json"
[ "$RC" = 2 ] && ok "④ --resume + --answers → rc 2" || no "④b rc=$RC"

# ⑤ open-terminal --continue (dry-run · not installed yet · then installed with a config work_dir)
OT="$SETUP_DIR/lib/open-terminal.sh"
H5="$T/h5"; mkdir -p "$H5/bots/lead"
before="$(listing "$H5")"
O5="$(env -i HOME="$H5" PATH="/usr/bin:/bin" TERM_PROGRAM=none MODS_SETUP_NO_OPEN=1 "$BASHX" "$OT" --continue lead 2>&1)"; r5=$?
[ "$r5" = 0 ] && ok "⑤ continue before install → rc 0" || no "⑤ rc=$r5: $O5"
printf '%s\n' "$O5" | grep -q '^OPEN [a-z-]* sh .*/state/continue-lead.sh' && ok "⑤ OPEN line names continue script" || no "⑤ OPEN line: $(printf '%s' "$O5" | head -1)"
printf '%s\n' "$O5" | grep -qF "$H5/bots/lead 에서 Claude Code 를 열고" && ok "⑤ opens in the bot folder" || no "⑤ folder: $O5"
printf '%s\n' "$O5" | grep -qF -- '--resume' && ok "⑤ says --resume" || no "⑤ no --resume"
[ "$(listing "$H5")" = "$before" ] && ok "⑤ dry-run wrote nothing" || no "⑤ dry-run wrote"
# installed: config work_dir wins
mkdir -p "$H5/.slackmod" "$H5/work/lead2"
printf '{"bots":[{"name":"lead","work_dir":"%s"}]}\n' "$H5/work/lead2" > "$H5/.slackmod/config.json"
printf 'lead\n' > "$H5/.slackmod/bots.list"
O5b="$(env -i HOME="$H5" PATH="/usr/bin:/bin" TERM_PROGRAM=none MODS_SETUP_NO_OPEN=1 "$BASHX" "$OT" --continue lead 2>&1)"
printf '%s\n' "$O5b" | grep -qF "$H5/work/lead2 에서 Claude Code 를 열고" && ok "⑤ installed → config work_dir" || no "⑤ config work_dir: $O5b"
# negative pair: the plain token window still needs an installed bot and says set-token
O5c="$(env -i HOME="$T/h5none" PATH="/usr/bin:/bin" MODS_SETUP_NO_OPEN=1 "$BASHX" "$OT" lead 2>&1)"; r5c=$?
[ "$r5c" = 2 ] && ok "⑤ token window still refuses an uninstalled bot (rc 2)" || no "⑤ token window rc=$r5c"
O5d="$(env -i HOME="$H5" PATH="/usr/bin:/bin" TERM_PROGRAM=none MODS_SETUP_NO_OPEN=1 "$BASHX" "$OT" lead 2>&1)"
printf '%s\n' "$O5d" | grep -qF 'slackmod set-token lead' && ! printf '%s\n' "$O5d" | grep -qF -- '--resume' && ok "⑤ token window unchanged" || no "⑤ token window: $O5d"

# ⑦ wizard text rules from the 11-02 trial (text checks · each with its bait)
SK="$SETUP_DIR/skills/mods-setup/SKILL.md"
s6="$(awk '/^## 6\. setup\.json 쓰기/{f=1;next} /^## /{f=0} f' "$SK")"
printf '%s\n' "$s6" | grep -qF '먼저 7번 0' && grep -qF -- '--watch-file ~/.slackmod/setup.json' "$SK" \
  && ! printf '%s\n' "$(awk '/^## 5\./{f=1;next} /^## /{f=0} f' "$SK")" | grep -qF -- '--watch-file' \
  && ok "⑦a SKILL 6: the record starts before setup.json is written (--watch-file ~/.slackmod/setup.json) · bait: not in 5" \
  || no "⑦a SKILL 6 order"
grep -F '순서: ⓪ 7번 0' "$SK" | grep -qF 'plan.py" FILE --out' && ok "⑦b answers mode: ⓪ record first, then plan.py" || no "⑦b answers order"
awk '/^## 5\./{f=1;next} /^## /{f=0} f' "$SK" | grep -qF '마크다운 표 하나' && ok "⑦c SKILL 5: the summary is one markdown table" || no "⑦c summary table"
s1="$(awk '/^## 1\. 감지·가져오기/{f=1;next} /^## /{f=0} f' "$SK")"; s5="$(awk '/^## 5\./{f=1;next} /^## /{f=0} f' "$SK")"
printf '%s\n' "$s1" | grep -qF '표는 질문 전에 별도 글로' && printf '%s\n' "$s1" | grep -qF '| 종류 | 이름 | 짧은 설명 |' \
  && printf '%s\n' "$s5" | grep -qF '표는 질문 전에 별도 글로' && printf '%s\n' "$s5" | grep -qF '같은 말만 하는 것은 금지' && printf '%s\n' "$s1" | grep -qF '도구 호출 없이 끝냅니다' && printf '%s\n' "$s5" | grep -qF '도구 호출 없이 끝냅니다' && printf '%s\n' "$s1" | grep -qF '전부 / 고르기 / 안 가져오기 중 하나를 적어 주세요' && printf '%s\n' "$s5" | grep -qF '설치 / 고치기 / 그만 중 하나를 적어 주세요' \
  && ! printf '%s\n' "$s1$s5" | grep -qF '아무 글이나' \
  && ! awk '/^## 2\./{f=1;next} /^## /{f=0} f' "$SK" | grep -qF '표는 질문 전에 별도 글로' \
  && ok "⑦f SKILL 1·5: import and summary tables go out as their own response that ends with no tool call, asking for the step's choice in words (no extra «네») · «showed it» without a table is banned · bait: not in 2" \
  || no "⑦f table before question"
awk '/^## 10\. 끝 말/{f=1;next} /^## /{f=0} f' "$SK" | grep -qF '도구 호출 없는 응답' && awk '/^## 10\. 끝 말/{f=1;next} /^## /{f=0} f' "$SK" | grep -qF '원본 지문 전후' \
  && ! awk '/^## 9\. /{f=1;next} /^## /{f=0} f' "$SK" | grep -qF '원본 지문 전후' \
  && ok "⑦g SKILL 10: the closing message is a response with no tool call and carries import.sh's last two lines · bait: not in 9" || no "⑦g closing lines"
awk '/^## 이어 하기/{f=1;next} /^## /{f=0} f' "$SK" | grep -qF 'plan.py" ~/.slackmod/setup.json' && ok "⑦d resume checks setup.json with plan.py first" || no "⑦d resume check"
grep -qF '아래 화살표로 «Yes»' "$REPO_ROOT/install.sh" && ! grep -qF '믿음을 고르세요' "$REPO_ROOT/install.sh" \
  && ok "⑦e install.sh: trust window line says arrow down to «Yes» (plain Enter = exit) · old wording gone" || no "⑦e trust line"

echo "m4-entry: PASS $PASSN · FAIL $FAIL"
[ "$FAIL" = 0 ]
