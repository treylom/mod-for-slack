#!/usr/bin/env bash
# check-public-meta.sh — the «.git 0 · 작성자 신원 0» gate of make-public.sh (also run by public/tests/check-public-meta-test.sh).
#   bash public/check-public-meta.sh <public-repo-dir> <tarball.tar.gz>      rc 0 = both hold · rc 3 = a FAIL line says which · rc 2 = usage
#   bash public/check-public-meta.sh --identity                              prints «NAME<TAB>EMAIL»: the one identity make-public.sh commits as
# 1) the tarball has 0 entries named .git — the builder's repo metadata (config · logs · reflog) never ships
# 2) every commit of the public repo has the fixed neutral identity below as author AND committer — no builder name / e-mail
# 3) no tar entry carries a local user / group name (uname · gname must be empty or root)
set -euo pipefail
PUB_NAME="mods-harness contributors"   # the name the plugins already carry as «author» (plugin.json)
PUB_EMAIL="noreply@example.invalid"    # reserved .invalid domain: no person, no mailbox
if [ "${1:-}" = "--identity" ]; then printf '%s\t%s\n' "$PUB_NAME" "$PUB_EMAIL"; exit 0; fi
[ $# -eq 2 ] && [ -d "$1" ] && [ -f "$2" ] || { sed -n 2,5p "$0" >&2; exit 2; }
REPO="$1"; TGZ="$2"
bad=0

listing="$(tar -tzf "$TGZ")" || { echo "FAIL tarball unreadable: $TGZ" >&2; exit 3; }
n_git="$(printf '%s\n' "$listing" | grep -cE '(^|/)\.git(/|$)' || true)"
if [ "$n_git" = 0 ]; then echo "PASS .git entries in tar: 0 ($(printf '%s\n' "$listing" | grep -c .) entries)"
else echo "FAIL .git entries in tar: $n_git (the builder's repo metadata is in the tarball)" >&2; bad=1; fi

want="$PUB_NAME|$PUB_EMAIL|$PUB_NAME|$PUB_EMAIL"
got="$(git -C "$REPO" log --format='%an|%ae|%cn|%ce' 2>/dev/null)" || got=""
others="$(printf '%s\n' "$got" | grep -v '^$' | grep -vxF "$want" || true)"
n_commits="$(printf '%s\n' "$got" | grep -c . || true)"
n_other="$(printf '%s' "$others" | grep -c . || true)"
if [ "$n_commits" -ge 1 ] && [ "$n_other" = 0 ]; then echo "PASS commit identity (author + committer, $n_commits commit): $PUB_NAME <$PUB_EMAIL>"
else echo "FAIL commit identity: $n_other of $n_commits commit(s) not by «$PUB_NAME <$PUB_EMAIL>» — found: $(printf '%s\n' "$others" | head -3 | tr '\n' ';')" >&2; bad=1; fi

# 3) no tar entry names a local user or group (a plain «tar -c» writes the builder's login into every header; git archive writes root/empty)
owners="$(python3 -I -c 'import sys, tarfile
names = set()
with tarfile.open(sys.argv[1], "r:gz") as t:
    for m in t:
        names.update(n for n in (m.uname, m.gname) if n not in ("", "root"))
print(len(names), ",".join(sorted(names)[:3]))' "$TGZ")" || owners="? unreadable"
if [ "${owners%% *}" = 0 ]; then echo "PASS tar owner names: none (uname/gname empty or root)"
else echo "FAIL tar owner names: ${owners} (a local user/group name is in the tar headers)" >&2; bad=1; fi

[ "$bad" = 0 ] || exit 3
echo "check-public-meta: .git 0 · 작성자 신원 0"
