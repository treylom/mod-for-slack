#!/usr/bin/env bash
# m26-plugin-name.sh — port/lib/rename-plugin.py + plugin-name.tsv: the bundle's plugin name (mod-for-slack) and its checks.
# Works on temp exports of the WORKING TREE (a throwaway git repo built from `git ls-files -co`), never on the source. bash 3.2 safe.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
RP="$PORT_DIR/lib/rename-plugin.py"
TSV="$PORT_DIR/lib/plugin-name.tsv"
. "$PORT_DIR/lib/runtime-set.sh"
T="$(mk_tmp m26)"
trap 'rm -rf "$T"' EXIT
HAVE_CLAUDE=0; command -v claude >/dev/null 2>&1 && HAVE_CLAUDE=1

# temp git repo from the working-tree files
TREPO="$T/repo"; mkdir -p "$TREPO"
git -C "$REPO_ROOT" ls-files -co --exclude-standard | while IFS= read -r f; do
  [ -f "$REPO_ROOT/$f" ] || continue
  mkdir -p "$TREPO/$(dirname "$f")"; cp -p "$REPO_ROOT/$f" "$TREPO/$f"
done
git -C "$TREPO" init -q . >/dev/null 2>&1
git -C "$TREPO" add -A >/dev/null 2>&1
git -C "$TREPO" -c user.name=t -c user.email=t@t commit -q -m m26 >/dev/null 2>&1 || { no "setup: temp repo commit"; finish; }

N=0
fresh() { N=$((N + 1)); FRESH="$T/ex$N"; export_runtime "$TREPO" HEAD "$FRESH" || { no "setup: export_runtime ($N)"; finish; }; }

# table sum of counts
SUM="$(python3 -I - "$TSV" <<'PY'
import sys
t = 0
for l in open(sys.argv[1], encoding='utf-8').read().split('\n'):
    if l.strip() and not l.startswith('#'):
        t += int(l.split('\t')[1])
print(t)
PY
)"

# T1
fresh; E1="$FRESH"
J1="$(python3 -I "$RP" --table "$TSV" "$E1" 2>"$T/t1.err")"; rc=$?
if [ "$rc" = 0 ] && python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d["name"]=="mod-for-slack" and d["replaced"]==int(sys.argv[2]) else 1)' "$J1" "$SUM"; then
  ok "T1 table applied · $J1 · sum=$SUM"
else no "T1 table apply rc=$rc json=$J1 sum=$SUM err=$(head -c 300 "$T/t1.err")"; fi

# T2
if [ "$HAVE_CLAUDE" = 1 ]; then
  claude plugin validate "$E1" >"$T/t2.out" 2>&1; rc=$?
  if [ "$rc" = 0 ]; then ok "T2 claude plugin validate on the renamed tree rc=0"; else no "T2 validate rc=$rc: $(head -c 300 "$T/t2.out")"; fi
else echo "SKIP T2 claude not found"; fi

# T3
python3 -I "$RP" --table "$TSV" "$E1" >/dev/null 2>"$T/t3.err"; rc=$?
if [ "$rc" = 3 ]; then ok "T3 second apply rc=3 ($(head -1 "$T/t3.err" | cut -c1-90))"; else no "T3 second apply rc=$rc (want 3)"; fi

# T4
fresh; E4="$FRESH"
python3 -I - "$TSV" "$T/t4.tsv" <<'PY'
import sys
out = []
for l in open(sys.argv[1], encoding='utf-8').read().split('\n'):
    p = l.split('\t')
    if len(p) == 4 and p[0] == '.claude-plugin/plugin.json':
        p[1] = '2'; l = '\t'.join(p)
    out.append(l)
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(out))
PY
listing "$E4" > "$T/t4.before"
python3 -I "$RP" --table "$T/t4.tsv" "$E4" >/dev/null 2>"$T/t4.err"; rc=$?
listing "$E4" > "$T/t4.after"
if [ "$rc" = 3 ] && cmp -s "$T/t4.before" "$T/t4.after" && [ -s "$T/t4.before" ]; then ok "T4 wrong count rc=3 and tree byte-identical ($(wc -l < "$T/t4.before" | tr -d ' ') entries)"
else no "T4 rc=$rc identical=$(cmp -s "$T/t4.before" "$T/t4.after" && echo yes || echo no)"; fi

# mutant table helper: apply the table minus rows of <file> whose old text contains <needle> (no checks)
cat > "$T/blind.py" <<'PY'
import sys
tsv, root, skipfile, needle = sys.argv[1:5]
for l in open(tsv, encoding='utf-8').read().split('\n'):
    if not l.strip() or l.startswith('#'):
        continue
    f, c, old, new = l.split('\t')
    if f == skipfile and needle in old:
        continue
    p = root + '/' + f
    s = open(p, encoding='utf-8', newline='').read().replace(old, new)
    open(p, 'w', encoding='utf-8', newline='').write(s)
PY
mutant_tsv() { python3 -I - "$TSV" "$1" "$2" "$3" <<'PY'
import sys
tsv, out, skipfile, needle = sys.argv[1:5]
keep = []
for l in open(tsv, encoding='utf-8').read().split('\n'):
    p = l.split('\t')
    if len(p) == 4 and p[0] == skipfile and needle in p[2]:
        continue
    keep.append(l)
open(out, 'w', encoding='utf-8').write('\n'.join(keep))
PY
}

# T5
fresh; E5="$FRESH"
mutant_tsv "$T/t5.tsv" src/session/index.js "{ plugin: 'mods-harness', key:"
python3 -I "$RP" --table "$T/t5.tsv" "$E5" >/dev/null 2>"$T/t5.err"; rc=$?
if [ "$rc" = 3 ] && grep -q 'src/session/index.js' "$T/t5.err"; then ok "T5a missing state-ref row: rc=3 naming src/session/index.js"
else no "T5a rc=$rc err=$(head -c 300 "$T/t5.err")"; fi
if [ "$HAVE_CLAUDE" = 1 ]; then
  fresh; E5b="$FRESH"
  python3 -I "$T/blind.py" "$TSV" "$E5b" src/session/index.js "{ plugin: 'mods-harness', key:"
  claude plugin validate "$E5b" >"$T/t5b.out" 2>&1; rc=$?
  if [ "$rc" != 0 ]; then ok "T5b validate refuses the tree with the stale state ref (rc=$rc)"; else no "T5b validate rc=0 on stale state-ref tree"; fi
else echo "SKIP T5b claude not found"; fi

# T6
fresh; E6="$FRESH"
python3 -I "$T/blind.py" "$TSV" "$E6" src/tools/index.js "mcp__mods-harness__"
if [ "$HAVE_CLAUDE" = 1 ]; then
  claude plugin validate "$E6" >"$T/t6.out" 2>&1; rc=$?
  if [ "$rc" = 0 ]; then ok "T6a validate accepts the tree with the stale mcp__ tool name (rc=0)"; else no "T6a validate rc=$rc (expected 0)"; fi
else echo "SKIP T6a claude not found"; fi
python3 -I "$RP" --check mod-for-slack "$E6" >/dev/null 2>"$T/t6.err"; rc=$?
if [ "$rc" = 3 ] && grep -q 'C4' "$T/t6.err"; then ok "T6b --check rc=3 with a C4 error"; else no "T6b rc=$rc err=$(head -c 300 "$T/t6.err")"; fi

# T7
fresh; E7="$FRESH"
python3 -I "$RP" --check mods-harness "$E7" >"$T/t7.out" 2>"$T/t7.err"; rc=$?
if [ "$rc" = 0 ]; then ok "T7 --check mods-harness on an unrenamed export rc=0"; else no "T7 rc=$rc err=$(head -c 300 "$T/t7.err")"; fi

# T8
fresh; E8="$FRESH"
python3 -I "$RP" --table "$TSV" "$E8" >/dev/null 2>&1 || no "T8 setup: apply failed"
printf "const X = 'mods-harness'\n" >> "$E8/src/ui/lib/band.js"
python3 -I "$RP" --check mod-for-slack "$E8" >/dev/null 2>"$T/t8.err"; rc=$?
if [ "$rc" = 3 ] && grep -q 'band.js' "$T/t8.err"; then ok "T8a C5: stray mods-harness line rc=3 naming band.js"; else no "T8a rc=$rc err=$(head -c 300 "$T/t8.err")"; fi
python3 -I - "$E8/src/ui/lib/band.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8', newline='').read()
bad = "const X = 'mods-harness'\n"
assert s.endswith(bad)
open(p, 'w', encoding='utf-8', newline='').write(s[:-len(bad)] + "const Y = '$HOME/.mods-harness/x'\n")
PY
python3 -I "$RP" --check mod-for-slack "$E8" >/dev/null 2>"$T/t8b.err"; rc=$?
if [ "$rc" = 0 ]; then ok "T8b C5: keep text (.mods-harness/) passes rc=0"; else no "T8b rc=$rc err=$(head -c 300 "$T/t8b.err")"; fi

# T9
LR="$(grep -n 'rename-plugin.py" --table' "$PORT_DIR/make-bundle.sh" | head -1 | cut -d: -f1)"
LE="$(grep -n '^export_runtime "\$REPO" "\$SHA"' "$PORT_DIR/make-bundle.sh" | head -1 | cut -d: -f1)"
LS="$(grep -n 'scrub-traces.py" --table' "$PORT_DIR/make-bundle.sh" | head -1 | cut -d: -f1)"
if [ -n "$LR" ] && [ -n "$LE" ] && [ -n "$LS" ] && [ "$LE" -lt "$LR" ] && [ "$LR" -lt "$LS" ]; then ok "T9 wiring: export_runtime:$LE < rename-plugin:$LR < scrub-traces:$LS"
else no "T9 wiring lines export=$LE rename=$LR scrub=$LS"; fi

# T11 (verifier 11-08: an editor trimmed the line-end space of the «new» cells → 14 lines lost one space)
printf 'src/ui/index.js\t1\tx: \tx:\n' > "$T/t11.tsv"
fresh; E11="$FRESH"
python3 -I "$RP" --table "$T/t11.tsv" "$E11" >/dev/null 2>"$T/t11.err"; rc=$?
if [ "$rc" = 2 ] && grep -q 'same spaces' "$T/t11.err"; then ok "T11a row whose old/new edge spaces differ: rc=2"; else no "T11a rc=$rc err=$(head -c 200 "$T/t11.err")"; fi
fresh; O11="$FRESH"; fresh; N11="$FRESH"
python3 -I "$RP" --table "$TSV" "$N11" >/dev/null 2>&1 || no "T11b setup: apply failed"
python3 -I - "$O11" "$N11" > "$T/t11b.out" 2>&1 <<'PY'
import os, sys
o, n = sys.argv[1], sys.argv[2]
lines = bad = 0
for d, _, fs in os.walk(n):
    for f in fs:
        pn = os.path.join(d, f); po = os.path.join(o, os.path.relpath(pn, n))
        try:
            a = open(po, encoding='utf-8', newline='').read().split('\n'); b = open(pn, encoding='utf-8', newline='').read().split('\n')
        except (OSError, UnicodeDecodeError):
            continue
        if a == b:
            continue
        if len(a) != len(b):
            print('LINECOUNT', pn); bad += 1; continue
        for x, y in zip(a, b):
            if x != y:
                lines += 1
                if y.replace('mod-for-slack', 'mods-harness') != x:
                    bad += 1; print('DIFF', os.path.relpath(pn, n), repr(x[:80]), repr(y[:80]))
print('changed lines', lines, 'bad', bad)
sys.exit(1 if bad or not lines else 0)
PY
rc=$?
if [ "$rc" = 0 ]; then ok "T11b every changed line = the old line with only the name swapped ($(tail -1 "$T/t11b.out"))"; else no "T11b $(tail -3 "$T/t11b.out")"; fi

# T10
if git -C "$REPO_ROOT" diff --quiet -- src hooks types .claude-plugin; then ok "T10 source files untouched (git diff --quiet)"; else no "T10 source tree has changes"; fi

finish
