#!/usr/bin/env python3
"""km-changelog.py — adds one line per new knowledge-manager (km) release to the public CHANGELOG.md.

    python3 -I public/km-changelog.py <CHANGELOG.md> [--notes OUT.md]

make-public.sh runs it on the staged copy of public/root/CHANGELOG.md (so the added lines go through the same trace
scan and jargon check as every root doc); a builder may also run it by hand on public/root/CHANGELOG.md and commit
the lines into the source.

Which releases: every km release that is neither a draft nor a pre-release, published (KST day) on or after the
date in the committed marker «<!-- km-releases-since: YYYY-MM-DD -->», whose release URL is not yet anywhere in the
file. The URL is the duplicate key, so a line a person reworded and committed is never added twice. No marker = no-op.
Line shape:  - **YYYY-MM-DD** · km <name> — <first bullet of the release notes, ≤ 120 chars> ([릴리스 노트](<url>))
The date is the KST day of publishedAt. A new line goes above the first entry dated the same day or earlier (newest first).

--notes OUT.md: writes the km lines added in this run (newest first; no file when none) for the GitHub release body —
hand-written entries new since the last public release are copied in by the person who publishes.
After each public release, commit the shipped CHANGELOG.md back over public/root/CHANGELOG.md — otherwise the km lines
are re-added on every build and the next release notes repeat them (the CHANGELOG itself stays free of duplicates).

Reading km: `gh release list/view` (gh = $KM_CHANGELOG_GH or «gh» · repo = $KM_CHANGELOG_REPO or
owner/knowledge-manager). gh missing / failing / timing out / unreadable output = ONE «km changelog: WARN …» line,
the file is left byte-identical and rc stays 0 — a km hiccup never stops a public build.
rc 0 = done (incl. WARN) · rc 2 = usage / unreadable CHANGELOG.
"""
import datetime
import json
import os
import re
import subprocess
import sys

GH = os.environ.get("KM_CHANGELOG_GH", "gh")
REPO = os.environ.get("KM_CHANGELOG_REPO", "owner/knowledge-manager")
KST = datetime.timezone(datetime.timedelta(hours=9))
MARK = re.compile(r"<!--\s*km-releases-since:\s*(\d{4}-\d{2}-\d{2})\s*-->")
ENTRY = re.compile(r"^- \*\*(\d{4}-\d{2}-\d{2})\*\*")
TIMEOUT = 60


class Skip(Exception):
    pass


def gh(*args):
    try:
        p = subprocess.run([GH, *args, "-R", REPO], capture_output=True, text=True, timeout=TIMEOUT)
    except FileNotFoundError:
        raise Skip(f"gh not found ({GH})")
    except subprocess.TimeoutExpired:
        raise Skip(f"gh timed out after {TIMEOUT}s")
    except OSError as e:
        raise Skip(f"gh not runnable ({e.__class__.__name__})")
    if p.returncode != 0:
        err = (p.stderr.strip().splitlines() or ["no message"])[-1][:160]
        raise Skip(f"gh {args[0]} {args[1]} rc {p.returncode}: {err}")
    try:
        return json.loads(p.stdout)
    except ValueError:
        raise Skip(f"gh {args[0]} {args[1]}: output is not JSON")


def kst_day(iso):
    t = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if t.tzinfo is None:
        raise ValueError("publishedAt without a time zone")
    return t.astimezone(KST).date().isoformat()


def summary(name, body):
    lines = [ln.strip() for ln in (body or "").splitlines()]
    pick = next((ln[2:].strip() for ln in lines if ln.startswith(("- ", "* "))), "")
    if not pick:
        pick = next((ln for ln in lines if ln and ln != name and not ln.startswith("#")), "")
    pick = re.sub(r"\s+", " ", pick) or "새 판"
    return pick if len(pick) <= 120 else pick[:119].rstrip() + "…"


def listed(url, text, added):
    """the whole URL is already in the file or in a line added this run («…/v1» is not hidden by «…/v10»)"""
    rx = re.compile(re.escape(url) + r"(?![A-Za-z0-9_.-])")
    return bool(rx.search(text)) or any(rx.search(ln) for _d, _t, ln in added)


def new_lines(text, since):
    rels = gh("release", "list", "--limit", "30", "--json", "tagName,name,publishedAt,isDraft,isPrerelease")
    if not isinstance(rels, list):
        raise Skip("gh release list: unexpected output")
    out = []
    for r in rels:
        try:
            if r.get("isDraft") or r.get("isPrerelease") or not r.get("publishedAt"):
                continue
            day = kst_day(r["publishedAt"])
            tag = r["tagName"]
            if not isinstance(tag, str) or not tag:
                raise TypeError
        except (KeyError, ValueError, AttributeError, TypeError, OverflowError):
            raise Skip("gh release list: unexpected fields")
        if day < since:
            continue
        guess = f"https://github.com/{REPO}/releases/tag/{tag}"
        if listed(guess, text, out):
            continue
        v = gh("release", "view", tag, "--json", "url,name,body")
        if not isinstance(v, dict):
            raise Skip("gh release view: unexpected output")
        url = v.get("url") or guess
        name = v.get("name") or r.get("name") or tag
        body = v.get("body") or ""
        if not all(isinstance(x, str) for x in (url, name, body)):
            raise Skip("gh release view: unexpected fields")
        if listed(url, text, out):
            continue
        name = name.strip()
        label = name if name.lower().startswith("km") else f"km {name}"
        out.append((day, tag, f"- **{day}** · {label} — {summary(name, body)} ([릴리스 노트]({url}))"))
    return out


def insert(lines, day, line):
    for i, ln in enumerate(lines):
        m = ENTRY.match(ln)
        if m:
            if m.group(1) <= day:  # same day: the release is new at build time → above hand entries
                lines.insert(i, line)
                return
    last = max((i for i, ln in enumerate(lines) if ENTRY.match(ln)), default=None)
    if last is not None:
        lines.insert(last + 1, line)
        return
    mark = next(i for i, ln in enumerate(lines) if MARK.search(ln))
    j = mark + 1
    while j < len(lines) and lines[j].lstrip().startswith("<!--"):
        j += 1  # keep the comment block right under the marker together
    lines.insert(j, line)


def main(argv):
    args = argv[1:]
    notes = None
    if "--notes" in args:
        k = args.index("--notes")
        if k + 1 >= len(args):
            sys.stderr.write(__doc__)
            return 2
        notes = args[k + 1]
        del args[k:k + 2]
    if len(args) != 1 or not os.path.isfile(args[0]) or os.path.islink(args[0]):
        sys.stderr.write(__doc__)
        return 2
    path = args[0]
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    m = MARK.search(text)
    if not m:
        print("km changelog: no km-releases-since marker — nothing added")
        return 0
    try:
        found = new_lines(text, m.group(1))
    except Skip as e:
        print(f"km changelog: WARN {e} — CHANGELOG left as it was")
        found = []
    lines = text.splitlines()
    order = sorted(reversed(found), key=lambda x: x[0])  # oldest first; same day = gh list order (newest first) reversed
    for day, _tag, line in order:
        insert(lines, day, line)
    if found:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    for day, tag, _line in reversed(order):
        print(f"km changelog: + {tag} ({day})")
    print(f"km changelog: {len(found)} added")
    if notes:
        pick = [ln for _d, _t, ln in reversed(order)]
        if pick:
            with open(notes, "w", encoding="utf-8") as fh:
                fh.write("\n".join(pick) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
