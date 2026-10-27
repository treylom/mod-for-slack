#!/usr/bin/env bash
# m2-import-write.sh — the import writer never writes outside the folder the person picked (security round 2 · ⑤ + NEW-1):
#   ① a planted link at a predictable temp name next to the destination («<dest>.tmp-<pid>» → a file outside) is not followed:
#      the outside file keeps its bytes and its mode (NEW-1 · the reviewer's own repro)
#   ② a folder on the way swapped for a link AFTER the check (the check passes, the write happens later) is not followed:
#      nothing appears outside (⑤ TOCTOU) — the write refuses
#   ③ a plain copy still lands, with the mode of the source (0644 · 0755 for an executable) · no temp file left behind
#   bash setup/tests/m2-import-write.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m2-import-write)"
trap 'rm -rf "$T"' EXIT
out="$(python3 -I - "$SETUP_DIR/lib" "$T" <<'PY'
import os, sys, stat
lib, T = sys.argv[1], sys.argv[2]
sys.path.insert(0, lib)
import detect_import as di

def fresh(name):
    root = os.path.join(T, name, 'pick'); os.makedirs(root)
    outside = os.path.join(T, name, 'outside'); os.makedirs(outside)
    src = os.path.join(T, name, 'src.md')
    with open(src, 'w') as f: f.write('NEW-COPY\n')
    os.chmod(src, 0o644)
    rep = di.Report(T, False); rep.roots = [os.path.abspath(root)]
    return root, outside, src, rep

# ① NEW-1: predictable temp name planted as a link to an outside victim
root, outside, src, rep = fresh('n1')
victim = os.path.join(outside, 'victim'); open(victim, 'w').write('SAFE\n'); os.chmod(victim, 0o600)
dest = os.path.join(root, 'probe.md')
os.symlink(victim, dest + '.tmp-%d' % os.getpid())
try:
    di.put_file(src, dest, rep, 'probe.md'); err = ''
except Exception as e:
    err = type(e).__name__
v = open(victim).read(); m = stat.S_IMODE(os.stat(victim).st_mode)
print('N1 victim=%s mode=%o dest=%s err=%s' % (v.strip(), m, os.path.isfile(dest) and not os.path.islink(dest), err or '-'))

# ② TOCTOU: the check passes, then the folder on the way becomes a link to the outside
root, outside, src, rep = fresh('n2')
sub = os.path.join(root, 'agents'); os.makedirs(sub)
dest = os.path.join(sub, 'x.md')
real_escapes = di.escapes
def swap_then_pass(d, r):
    ok = real_escapes(d, r)           # the real check, on the real folder (passes)
    os.rename(sub, sub + '.moved'); os.symlink(outside, sub)   # … then the swap the check cannot see
    return ok
di.escapes = swap_then_pass
try:
    di.put_file(src, dest, rep, 'agents/x.md'); err = ''
except Exception as e:
    err = type(e).__name__
di.escapes = real_escapes
print('N2 outside_files=%d err=%s errors=%d' % (len(os.listdir(outside)), err or '-', rep.errors))

# ③ plain copy (negative): lands · mode kept · no temp left · executable keeps 0755
root, outside, src, rep = fresh('n3')
dest = os.path.join(root, 'sub', 'plain.md')
di.put_file(src, dest, rep, 'sub/plain.md')
exe = os.path.join(T, 'n3', 'run.sh'); open(exe, 'w').write('#!/bin/sh\n'); os.chmod(exe, 0o755)
dexe = os.path.join(root, 'run.sh'); di.put_file(exe, dexe, rep, 'run.sh')
left = [n for d, _, fs in os.walk(root) for n in fs if '.tmp' in n]
print('N3 plain=%s mode=%o exe_mode=%o temps=%d copied=%d' % (open(dest).read().strip(), stat.S_IMODE(os.stat(dest).st_mode),
      stat.S_IMODE(os.stat(dexe).st_mode), len(left), rep.copied))

# ④ (security review 10-26 · round 3) MANIFEST.txt in the picked folder — the real «import» run, three ways:
#    M1 a hard link to an outside 0600 file planted there · M2 swapped for a symlink right after the check · N a plain run
import io, json, contextlib
def run_import(name, plant=None, swap=False):
    h = os.path.join(T, name, 'home'); os.makedirs(os.path.join(h, '.claude', 'agents'))
    open(os.path.join(h, '.claude', 'CLAUDE.md'), 'w').write('# my rules\n')
    o = io.StringIO()
    with contextlib.redirect_stdout(o):
        di.main(['detect', '--home', h])
    ids = [it['id'] for it in json.loads(o.getvalue())['items']]
    to = os.path.join(T, name, 'pick'); os.makedirs(to)
    victim = os.path.join(T, name, 'outside-victim'); open(victim, 'w').write('PRIVATE-LINE\n'); os.chmod(victim, 0o600)
    mp = os.path.join(to, 'MANIFEST.txt')
    if plant == 'hardlink':
        os.link(victim, mp)
    if plant == 'fifo':
        os.mkfifo(mp)
    real = di.escapes
    def swap_after(d, r):
        res = real(d, r)
        if swap and d.endswith('MANIFEST.txt') and not res:
            if os.path.lexists(d): os.unlink(d)
            os.symlink(victim, d)
        return res
    di.escapes = swap_after
    o = io.StringIO()
    try:
        with contextlib.redirect_stdout(o), contextlib.redirect_stderr(o):
            rc = di.main(['import', '--from', ','.join(ids), '--home', h, '--to', to])
    finally:
        di.escapes = real
    v = open(victim).read(); vm = stat.S_IMODE(os.stat(victim).st_mode)
    man = open(mp).read() if os.path.isfile(mp) and not os.path.islink(mp) else ''
    return 'rc=%s victim=%s vmode=%o manifest_has_private=%s manifest_lines=%d' % (
        rc, v.strip().replace('\n', '|')[:40], vm, 'PRIVATE-LINE' in man, len([l for l in man.split('\n') if l]))
print('M1 ' + run_import('m1', plant='hardlink'))
print('M2 ' + run_import('m2', swap=True))
print('MN ' + run_import('mn'))
# ④ NOTE (security review r3 ⑤-a): a FIFO planted as MANIFEST.txt — opening it to read must not wait for a writer (10 s alarm = hung)
import signal
class _Hung(BaseException):   # not TimeoutError: that is an OSError, and read_own swallows OSError
    pass
def _hung(*a):
    raise _Hung()
signal.signal(signal.SIGALRM, _hung); signal.alarm(10)
try:
    mf = run_import('mf', plant='fifo')
except _Hung:
    mf = 'HUNG'
finally:
    signal.alarm(0)
print('MF ' + mf)
PY
)"
printf '%s\n' "$out" | sed 's/^/  /'
n1="$(printf '%s\n' "$out" | grep '^N1 ')"; n2="$(printf '%s\n' "$out" | grep '^N2 ')"; n3="$(printf '%s\n' "$out" | grep '^N3 ')"
case "$n1" in *"victim=SAFE mode=600"*) ok "① planted temp-name link not followed (outside file SAFE · 0600)";; *) no "① NEW-1: $n1";; esac
case "$n2" in *"outside_files=0"*) ok "② folder swapped for a link after the check: nothing written outside ($n2)";; *) no "② TOCTOU: $n2";; esac
case "$n3" in *"plain=NEW-COPY mode=644 exe_mode=755 temps=0 copied=2"*) ok "③ plain copies land · modes kept · no temp left";; *) no "③ $n3";; esac
m1="$(printf '%s\n' "$out" | grep '^M1 ')"; m2="$(printf '%s\n' "$out" | grep '^M2 ')"; mn="$(printf '%s\n' "$out" | grep '^MN ')"
case "$m1" in *"victim=PRIVATE-LINE vmode=600 manifest_has_private=False"*) ok "④ MANIFEST.txt planted as a hard link: outside file untouched (0600) · its text not read into the manifest";; *) no "④ hard link: $m1";; esac
case "$m2" in *"victim=PRIVATE-LINE vmode=600"*) ok "④ MANIFEST.txt swapped for a symlink after the check: outside file untouched (0600)";; *) no "④ symlink swap: $m2";; esac
case "$mn" in *"rc=0 "*"manifest_has_private=False manifest_lines="[1-9]*) ok "④ plain run: MANIFEST.txt written ($mn)";; *) no "④ plain: $mn";; esac
mf="$(printf '%s\n' "$out" | grep '^MF ')"
case "$mf" in "MF rc="*) ok "④ NOTE MANIFEST.txt planted as a FIFO: the run does not hang ($mf)";; *) no "④ FIFO: ${mf:-no MF line}";; esac
finish
