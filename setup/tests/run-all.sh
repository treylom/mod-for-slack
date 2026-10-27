#!/usr/bin/env bash
# run-all.sh — runs every setup/tests/*.sh test (not the helpers · not itself) under macOS /bin/bash 3.2 when present, then the
# port/tests/config-unit.sh contract test, port/tests/route-judge.sh (the router's example judge · fake local API) and a trace
# scan of setup/. Prints one line per file: rc and PASS/FAIL counts.
#   bash setup/tests/run-all.sh [name-prefix]        e.g. «m1» runs only m1-*.sh · «persona» only persona-test.sh
#   MUTATE=1 bash setup/tests/run-all.sh             also turns each check off, one at a time, and counts what the tests catch
# rc 0 = all files rc 0. (merged: wizard/installer runner + persona/doctor runner · 2026-10-24 integration)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
cd "$REPO" || exit 2   # the mutation runs take repo-relative paths
BASHX=/bin/bash; [ -x "$BASHX" ] || BASHX=bash
PREFIX="${1:-}"
LOGD="$(mktemp -d "${TMPDIR:-/tmp}/setup-tests.XXXXXX")"
fail=0; tp=0; tf=0
run_one() { # run_one <label> <script> [args…]
  local label="$1" script="$2" log rc p f; shift 2
  log="$LOGD/$(printf '%s' "$label" | tr '/ ' '__').log"
  "$BASHX" "$script" "$@" > "$log" 2>&1; rc=$?
  p="$(grep -c '^PASS' "$log" || true)"; f="$(grep -c '^FAIL' "$log" || true)"
  printf '%-34s rc=%s  PASS %-4s FAIL %s\n' "$label" "$rc" "$p" "$f"
  tp=$((tp + p)); tf=$((tf + f))
  if [ "$rc" -ne 0 ]; then fail=1; grep -E '^(FAIL|ALIVE|INVALID|HIT)' "$log" | head -5; fi
}
for t in "$HERE"/*.sh; do
  n="$(basename "$t")"
  # helpers (lib · plan-lib · mutate) and hand-run tests (the two m3-* need a built bundle · the live one needs the relay variables)
  case "$n" in lib.sh|plan-lib.sh|mutate.sh|run-all.sh|m3-bundle-layout.sh|m3-live-wizard.sh|m3-g34-live.sh) continue ;; esac
  case "$n" in "$PREFIX"*) ;; *) continue ;; esac
  run_one "$n" "$t"
done
[ -z "$PREFIX" ] && [ -f "$REPO/port/tests/config-unit.sh" ] && run_one "port/tests/config-unit.sh" "$REPO/port/tests/config-unit.sh"
[ -z "$PREFIX" ] && [ -f "$REPO/port/tests/route-judge.sh" ] && run_one "port/tests/route-judge.sh" "$REPO/port/tests/route-judge.sh"
if [ -z "$PREFIX" ]; then
  if [ -f "$REPO/port/scan-traces.sh" ]; then
    out="$(cd "$REPO" && bash port/scan-traces.sh setup 2>&1)"; rc=$?
    printf '%-34s rc=%s  %s\n' "scan-traces setup/ (0 hits)" "$rc" "$(printf '%s\n' "$out" | tail -n 1)"
    [ "$rc" -eq 0 ] || { fail=1; printf '%s\n' "$out" | grep -E '^HIT' | head -10; }
  else echo "scan-traces: port/scan-traces.sh not found — skipped"; fi
fi
if [ -n "${MUTATE:-}" ]; then   # each line = one check turned off; every one must turn a test red
  run_one "persona-check mutants" "$HERE/mutate.sh" setup/lib/persona-check.py PERSONA_CHECK setup/tests/persona-check-mutants.txt setup/tests/persona-test.sh
  run_one "persona-fill mutants" "$HERE/mutate.sh" setup/lib/persona-fill.py PERSONA_FILL setup/tests/persona-fill-mutants.txt setup/tests/persona-test.sh
  run_one "doctor mutants" "$HERE/mutate.sh" setup/lib/doctor.sh DOCTOR setup/tests/doctor-mutants.txt setup/tests/doctor-test.sh
fi
echo "합계: PASS $tp · FAIL $tf · rc=$fail (logs $LOGD)"
exit $fail
