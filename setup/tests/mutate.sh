#!/usr/bin/env bash
# mutate.sh — turn one check off at a time and see whether the matching test notices (RED = caught).
#   [JOBS=4] bash setup/tests/mutate.sh <target file> <ENV VAR the test reads the target from> <spec file> <test script>
# spec lines:  description ||| exact old text ||| new text   (the old text must occur exactly once in the target · # = comment)
# For each line: copy the target to a temp file with that one replacement, run the test with ENV VAR pointing at the copy
# (up to JOBS runs at once, default 1; the tests keep everything under their own mktemp dir; FAILFAST=1 makes a test stop at
# its first failing case, which is all a mutant has to cause). A test run that exits non-zero = the mutation was caught. Prints each mutant's first failing cases so a «caught» that only came from a crash is easy to spot.
# Last line: «변이 N/M 잡힘 · 무효 K · 살아남음 L». rc 0 = every mutant caught and every spec line valid · 1 = otherwise.
# Writes only under a mktemp dir.
set -uo pipefail
TARGET="${1:-}"; ENVVAR="${2:-}"; SPEC="${3:-}"; TEST="${4:-}"
[ -f "$TARGET" ] && [ -n "$ENVVAR" ] && [ -f "$SPEC" ] && [ -f "$TEST" ] || { echo "usage: mutate.sh <target> <ENV VAR> <spec file> <test script>" >&2; exit 2; }
PY="${PYTHON:-python3}"
JOBS="${JOBS:-1}"
W="$(mktemp -d "${TMPDIR:-/tmp}/mutate.XXXXXX")"
trap 'rm -rf "$W"' EXIT
total=0; invalid=0
descs=()
# phase 1: build every mutant
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *' |||') line="$line " ;; esac   # an empty replacement: editors trim the trailing space
  desc="${line%% ||| *}"; rest="${line#* ||| }"; old="${rest%% ||| *}"; new="${rest#* ||| }"
  total=$((total + 1)); descs[$total]="$desc"
  mutant="$W/m$total-$(basename "$TARGET")"
  "$PY" -I - "$TARGET" "$old" "$new" "$mutant" <<'EOF'
import os, sys
src, old, new, dst = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('        old text found %d times' % n)
    sys.exit(3)
open(dst, 'w', encoding='utf-8').write(s.replace(old, new, 1))
os.chmod(dst, 0o755)
EOF
  if [ $? -ne 0 ]; then invalid=$((invalid + 1)); : > "$W/invalid$total"; fi
done < "$SPEC"
if [ -n "${CHECK_ONLY:-}" ]; then   # spec check only: does every «old text» occur exactly once in the target?
  i=1
  while [ "$i" -le "$total" ]; do [ -e "$W/invalid$i" ] && echo "INVALID  ${descs[$i]}"; i=$((i + 1)); done
  echo "스펙 검사: 줄 $total · 무효 $invalid"
  [ "$invalid" -eq 0 ]; exit $?
fi
# phase 2: run the tests, JOBS at a time
i=1
while [ "$i" -le "$total" ]; do
  if [ ! -e "$W/invalid$i" ]; then
    while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$JOBS" ]; do sleep 0.3; done
    ( env FAILFAST=1 "$ENVVAR=$W/m$i-$(basename "$TARGET")" bash "$TEST" > "$W/out$i.txt" 2>&1; echo $? > "$W/rc$i" ) &
  fi
  i=$((i + 1))
done
wait
# phase 3: report in spec order
caught=0; alive=0
i=1
while [ "$i" -le "$total" ]; do
  if [ -e "$W/invalid$i" ]; then echo "INVALID  ${descs[$i]}"
  else
    trc="$(cat "$W/rc$i")"
    if [ "$trc" -ne 0 ]; then
      caught=$((caught + 1)); nf="$(grep -c '^FAIL' "$W/out$i.txt")"
      echo "RED      ${descs[$i]}  (test rc $trc · $nf failing)"
      grep '^FAIL' "$W/out$i.txt" | head -2 | sed 's/^/           /'
    else
      alive=$((alive + 1)); echo "ALIVE    ${descs[$i]}"
    fi
  fi
  i=$((i + 1))
done
echo "변이 $caught/$total 잡힘 · 무효 $invalid · 살아남음 $alive"
[ "$caught" -eq "$total" ] && [ "$invalid" -eq 0 ]
