#!/usr/bin/env python3
"""projects.py — work-folder candidates under one folder (read only · JSON on stdout).

  python3 -I projects.py --root DIR [--depth 2] [--history history.json] [--home H]

Output: {"schema":1,"root":abs,"candidates":[{"path":abs,"name":basename,"why":["git","claude_md","agents_md","history:N"]}]}
- Looks at folders at depth 0..--depth under root (root = 0) holding .git (folder or file) · CLAUDE.md · AGENTS.md.
- Folder links are not followed · nothing outside root is listed (checked on the resolved path) · hidden folders and
  node_modules are skipped · at most 40 candidates.
- --history (history.py output): its folders that sit under root are candidates too (why «history:N»); others are left out.
- Order = history sessions (most first) → path. --home is accepted for the wizard's call shape; nothing is read from it.
rc 0 = done · 2 = root missing / not a folder / usage.
"""
import json
import os
import sys

MAX_CANDIDATES = 40
MAX_WALK = 5000
SKIP = {'node_modules'}


def usage(msg):
    sys.stderr.write('projects: %s\n' % msg)
    sys.exit(2)


def parse_args(argv):
    a = {'root': None, 'depth': '2', 'history': None, 'home': None}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ('-h', '--help'):
            sys.stdout.write(__doc__)
            sys.exit(0)
        if k in ('--root', '--depth', '--history', '--home'):
            if i + 1 >= len(argv):
                usage('%s needs a value' % k)
            a[k[2:]] = argv[i + 1]
            i += 2
            continue
        usage('unknown argument %s' % k)
    if not a['root']:
        usage('--root is required')
    if not os.path.isdir(a['root']):
        usage('root is not a folder: %s' % a['root'])
    try:
        a['depth'] = int(a['depth'])
    except ValueError:
        usage('--depth must be a whole number')
    if a['depth'] < 0 or a['depth'] > 6:
        usage('--depth must be 0..6')
    return a


def inside(path, root_real):
    r = os.path.realpath(path)
    return r == root_real or r.startswith(root_real.rstrip(os.sep) + os.sep)


def markers(d):
    why = []
    if os.path.lexists(os.path.join(d, '.git')):
        why.append('git')
    if os.path.lexists(os.path.join(d, 'CLAUDE.md')):
        why.append('claude_md')
    if os.path.lexists(os.path.join(d, 'AGENTS.md')):
        why.append('agents_md')
    return why


def walk(root, root_real, depth):
    found = {}
    queue = [(root, 0)]
    seen = 0
    while queue and seen < MAX_WALK:
        d, dep = queue.pop(0)
        seen += 1
        if not inside(d, root_real):
            continue
        w = markers(d)
        if w:
            found[d] = w
        if dep >= depth:
            continue
        try:
            entries = sorted(os.scandir(d), key=lambda e: e.name)
        except OSError:
            continue
        for e in entries:
            if e.name.startswith('.') or e.name in SKIP:
                continue
            try:
                if e.is_symlink() or not e.is_dir(follow_symlinks=False):
                    continue
            except OSError:
                continue
            queue.append((os.path.join(d, e.name), dep + 1))
    return found


def history_folders(path, root, root_real):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            h = json.load(f)
    except (OSError, ValueError):
        usage('history file not readable as JSON: %s' % path)
    out = {}
    folders = h.get('folders') if isinstance(h, dict) else None
    if not isinstance(folders, list):
        return out
    for x in folders:
        if not isinstance(x, dict) or not isinstance(x.get('path'), str) or not os.path.isabs(x['path']):
            continue
        p = os.path.normpath(x['path'])
        n = x.get('sessions')
        n = n if isinstance(n, int) and n >= 0 else 0
        if not (p == root or p.startswith(root.rstrip(os.sep) + os.sep)):
            continue
        if os.path.islink(p) or not os.path.isdir(p) or not inside(p, root_real):
            continue
        out[p] = out.get(p, 0) + n
    return out


def main():
    a = parse_args(sys.argv[1:])
    root = os.path.normpath(os.path.abspath(a['root']))
    root_real = os.path.realpath(root)
    found = walk(root, root_real, a['depth'])
    hist = history_folders(a['history'], root, root_real) if a['history'] else {}
    cands = []
    for p in set(found) | set(hist):
        why = list(found.get(p, []))
        n = hist.get(p)
        if n is not None:
            why.append('history:%d' % n)
        cands.append((-(n or 0), p, why))
    cands.sort()
    out = {'schema': 1, 'root': root,
           'candidates': [{'path': p, 'name': os.path.basename(p) or p, 'why': why} for _, p, why in cands[:MAX_CANDIDATES]]}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
