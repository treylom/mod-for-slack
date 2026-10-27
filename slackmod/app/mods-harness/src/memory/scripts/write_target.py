#!/usr/bin/env python3
"""Memory write guard: where would this $.fs.write really land? (stdlib only · reads metadata only · writes nothing)

봇 재검 10-18: the string-only check let a symlink outside the guarded roots create a file inside one.
This resolves the target the way the kernel will (symlinks and «..» in order, a dangling final link followed),
then walks the real parent chain and compares each existing folder with the guarded roots by identity
(st_dev, st_ino) — so a symlink, a macOS firmlink, a case or Unicode-form variant of a guarded folder all hit —
and also by normalized path (roots that do not exist yet). An existing file with more than one hard link is
refused (봇 r3: count, do not search). «Does not exist» is the only failure
treated as «nothing there»; a permission or I/O error anywhere (root, parent chain, the file itself) refuses.

Not covered (said, not hidden): a link swapped between this check and the write (time-of-check race);
writes that do not go through $.fs.write.

stdout: one JSON line {"hit": <root or "">, "target": <resolved path>, "why": <reason or "">, "error": <"" or reason>}.
Any error means the caller refuses the write.
"""
import argparse
import json
import os
import stat
import sys
import unicodedata



def key(p):
    return unicodedata.normalize('NFC', p).casefold()


def _judge(path, cwd, roots):
    if not path:
        return {'error': 'empty path'}
    if not os.path.isabs(path):
        if not cwd or not os.path.isabs(cwd):
            return {'error': 'relative path with no working directory'}
        path = os.path.join(cwd, path)
    target = os.path.realpath(path)
    if os.path.islink(target):
        return {'error': 'link loop or unresolvable link', 'target': target}
    ids, keys = {}, {}
    for r in roots:
        for form in (r, os.path.realpath(r)):
            keys[key(form.rstrip('/') or '/')] = r
        st = stat_or_absent(os.stat, r)  # absent root = compared by path only; unreadable = raises (refuse)
        if st is not None:
            ids[(st.st_dev, st.st_ino)] = r
    # the real parent chain, nearest first (the target itself included)
    p = target
    while True:
        if key(p) in keys:
            return {'hit': keys[key(p)], 'target': target, 'why': 'path'}
        st = stat_or_absent(os.stat, p)  # a folder that does not exist yet is skipped; one we cannot stat refuses
        if st is not None:
            hit = ids.get((st.st_dev, st.st_ino))
            if hit:
                return {'hit': hit, 'target': target, 'why': 'same folder (identity)'}
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    # A hard link writes the same file in place. 봇 재검 r2: searching the roots for that file passed the write when
    # the search failed (unreadable subfolder). 봇: no search — while roots are guarded, writing to an
    # existing file with more than one link is refused outright (an ordinary file has 1). Cost: an outside file that
    # happens to be hard-linked elsewhere (not under a root) is refused too.
    st = stat_or_absent(os.lstat, target)
    if st is not None and not stat.S_ISDIR(st.st_mode) and st.st_nlink > 1:
        return {'hit': '(hard link)', 'target': target, 'why': 'existing file has %d links' % st.st_nlink}
    return {'hit': '', 'target': target, 'why': ''}


def stat_or_absent(fn, p):
    """None only when the path does not exist (or a parent is not a folder). Any other failure — permission, I/O —
    propagates, and judge() turns it into an error = refuse (봇 재검 r2: «없음» ≠ «못 읽음»)."""
    try:
        return fn(p)
    except (FileNotFoundError, NotADirectoryError):
        return None


def judge(path, cwd, roots):
    try:
        out = _judge(path, cwd, roots)
    except Exception as exc:  # any surprise = refuse (the caller fails closed)
        out = {'error': type(exc).__name__ + ': ' + str(exc)[:160]}
    for k in ('hit', 'target', 'why', 'error'):
        out.setdefault(k, '')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--cwd', default='')
    ap.add_argument('--root', action='append', default=[])
    ap.add_argument('path')
    a = ap.parse_args(argv)
    sys.stdout.write(json.dumps(judge(a.path, a.cwd, a.root), ensure_ascii=False) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
