#!/usr/bin/env python3
"""mask-public-names.py — scan-view helper of make-public.sh.

    python3 -I public/mask-public-names.py <allowed-names.txt> <scan-view-dir>

Replaces each exact allowed string (longest first) with «ALLOWED-NAME» in the scan view's top-level *.md files and
every file under rules/ — only where the string stands alone (neither the character before nor the one after is a
letter, digit, «_», «.» or «-»), so «…/ThisCode-other» or «xx-team-harness» is left whole for the scan. Never touches the real tree (make-public passes a
copy) · the allowed strings are literals (escaped), not patterns · symlinks refused.
rc 0 = done · rc 2 = usage / unreadable list / symlink found.
"""
import os
import re
import sys

if len(sys.argv) != 3 or not os.path.isdir(sys.argv[2]):
    sys.stderr.write(__doc__)
    sys.exit(2)
names = []
with open(sys.argv[1], encoding="utf-8") as fh:
    for line in fh:
        s = line.strip()
        if s and not s.startswith("#"):
            names.append(s)
if not names:
    sys.exit("mask-public-names: empty list")
names.sort(key=len, reverse=True)
rxs = [re.compile(r"(?<![A-Za-z0-9_.-])" + re.escape(s) + r"(?![A-Za-z0-9_.-])") for s in names]
root = sys.argv[2]

targets = [os.path.join(root, f) for f in sorted(os.listdir(root)) if f.endswith(".md")]
rules = os.path.join(root, "rules")
if os.path.isdir(rules):
    for d, _dirs, files in os.walk(rules):
        targets += [os.path.join(d, f) for f in sorted(files)]

n = 0
for p in targets:
    if os.path.islink(p):
        sys.stderr.write(f"mask-public-names: symlink refused: {os.path.relpath(p, root)}\n")
        sys.exit(2)
    if not os.path.isfile(p):
        continue
    with open(p, encoding="utf-8", errors="surrogateescape") as fh:
        t = fh.read()
    m = t
    for rx in rxs:
        m = rx.sub("ALLOWED-NAME", m)
    if m != t:
        n += 1
        with open(p, "w", encoding="utf-8", errors="surrogateescape") as fh:
            fh.write(m)
print(f"[make-public] masked allowed public names in {n} file(s)")
