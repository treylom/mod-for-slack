#!/usr/bin/env bash
# make-public.sh — assemble the public repo tree from ONE commit (+ the Slack bridge commit). Never pushes.
#   bash public/make-public.sh <commit> --thiscode-repo DIR [--thiscode-ref REF] [--bridge-expect dist/F=SHA]… [--out DIR] [--partial]
# Layout (design doc 설계 메모):  install.sh (wizard entry) · setup/ (wizard plugin) · slackmod/ (the customer bundle tree,
#   built by port/make-bundle.sh: install.sh bin lib hooks templates app/…) · README.md SUPPORT.md LICENSE (public/root/).
# Gates (any failure = no tree, rc 3): make-bundle rc 0 · trace scan over the WHOLE tree = TOTAL 0 (port/scan-traces.sh +
#   port/lib/traces.tsv from <commit>) · bash -n on every .sh · python compile on every .py · node --check on setup .js/.mjs ·
#   claude plugin validate (setup/ and slackmod/app/mods-harness) · public/check-public-meta.sh = «.git 0 · 작성자 신원 0».
# Output: <out>/<name>/ = a fresh git repo with exactly ONE commit (no history, no remote) made under a fixed neutral identity
#   (never the builder's git config — if the folder is pushed later, that identity is what goes public) + <out>/<name>.tar.gz
#   (committed files only: no .git, no builder user/group names) + .sha256 + <name>.release-notes.md (km lines added in this build, if any).
# CHANGELOG.md (public/root/, optional): public/km-changelog.py adds a line per km release not yet listed (gh; failure = WARN).
#   After a public release, commit <out>/<name>/CHANGELOG.md back over public/root/CHANGELOG.md (else the next notes repeat km lines).
# --partial = allow a commit that has no setup/ or root install.sh yet (assembly smoke only; the tree is marked PARTIAL).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/.." && pwd -P)"
COMMIT="${1:-}"; [ -n "$COMMIT" ] && shift || { sed -n 2,14p "$0"; exit 2; }
TC_REPO=""; TC_REF=HEAD; OUT="$PWD"; PARTIAL=0; EXPECT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --thiscode-repo) TC_REPO="${2:?}"; shift 2 ;;
    --thiscode-ref) TC_REF="${2:?}"; shift 2 ;;
    --bridge-expect) EXPECT+=(--bridge-expect "${2:?}"); shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --partial) PARTIAL=1; shift ;;
    *) echo "make-public: unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$TC_REPO" ] || { echo "make-public: --thiscode-repo DIR required" >&2; exit 2; }
SHA="$(git -C "$REPO" rev-parse --verify "$COMMIT^{commit}")"
TC_SHA="$(git -C "$TC_REPO" rev-parse --verify "$TC_REF^{commit}")"
NAME="slackmod-$(date +%Y%m%d)-${SHA:0:7}-b${TC_SHA:0:7}"
W="$(mktemp -d "${TMPDIR:-/tmp}/make-public.XXXXXX")"
trap 'rm -rf "$W"' EXIT
S="$W/$NAME"; mkdir -p "$S" "$W/src" "$W/bundle" "$OUT"
step() { printf '[make-public] %s\n' "$*"; }
fail() { echo "make-public: $*" >&2; exit 3; }

step "commit ${SHA:0:12} · bridge ${TC_SHA:0:12}"
# symlinks: refused before anything is bundled — make-bundle's «zip -r» follows a folder link, so one link to a home
# folder would pack that whole folder (11-02 bait run: zip at 2.8 GB RSS before it was stopped). The repo has none.
# (read the whole listing with awk — «| grep -q» stops early, the writer gets SIGPIPE and pipefail turns a hit into «no»)
LINKS="$(git -C "$REPO" ls-tree -r "$SHA" | awk -F'\t' '$1 ~ /^120000 / {print $2}')" || fail "git ls-tree failed on ${SHA:0:12}"
if [ -n "$LINKS" ]; then printf '%s\n' "$LINKS" | head -5 >&2; fail "symlink in ${SHA:0:12} (refused before bundling)"; fi
LINKS="$(git -C "$TC_REPO" ls-tree -r "$TC_SHA" -- vendor/claude-channel-server | awk -F'\t' '$1 ~ /^120000 / {print $2}')" || fail "git ls-tree failed on the bridge"
[ -z "$LINKS" ] || fail "symlink in the bridge ${TC_SHA:0:12} vendor/claude-channel-server (refused before bundling)"
# 0. the tools come from <commit>, never the working tree
git -C "$REPO" archive "$SHA" port public | tar -x -C "$W/src"
[ -f "$W/src/port/make-bundle.sh" ] || fail "port/make-bundle.sh is not in ${SHA:0:12}"
[ -d "$W/src/public/root" ] || fail "public/root is not in ${SHA:0:12}"

# 1. the customer bundle (scrubbed + scanned by make-bundle itself) — run from a detached checkout of <commit>
git -C "$REPO" worktree add --detach "$W/wt" "$SHA" >/dev/null 2>&1 || fail "worktree add failed"
cleanup_wt() { git -C "$REPO" worktree remove --force "$W/wt" >/dev/null 2>&1 || true; rm -rf "$W"; }
trap cleanup_wt EXIT
( cd "$W/wt" && bash port/make-bundle.sh "$SHA" --thiscode-repo "$TC_REPO" --thiscode-ref "$TC_SHA" ${EXPECT[@]+"${EXPECT[@]}"} --out "$W/bundle" ) \
  >"$W/make-bundle.log" 2>&1 || { tail -20 "$W/make-bundle.log" >&2; fail "make-bundle failed"; }
ZIP="$(ls "$W/bundle"/*.zip | head -1)"
( cd "$W/bundle" && unzip -q "$ZIP" )
BDIR="$(ls -d "$W/bundle"/slackmod-*/ | head -1)"
mv "$BDIR" "$S/slackmod"
step "bundle: $(basename "$ZIP") · $(find "$S/slackmod" -type f | wc -l | tr -d ' ') files"

# 2. wizard plugin + entry + root docs (as committed — they must already be clean; the scan below proves it)
if git -C "$REPO" cat-file -e "$SHA:setup" 2>/dev/null && git -C "$REPO" cat-file -e "$SHA:install.sh" 2>/dev/null; then
  git -C "$REPO" archive "$SHA" setup install.sh | tar -x -C "$S"
  chmod 755 "$S/install.sh"
else
  [ "$PARTIAL" = 1 ] || fail "setup/ or root install.sh is not in ${SHA:0:12} (use --partial for an assembly smoke)"
  echo "PARTIAL: no setup/ or root install.sh in ${SHA:0:12}" > "$S/PARTIAL.txt"
  step "PARTIAL tree (no wizard yet)"
fi
cp "$W/src/public/root/README.md" "$W/src/public/root/SUPPORT.md" "$W/src/public/root/LICENSE" "$S/"
# the change log (optional file): km releases not yet listed get one line each, on the staged copy — before the scan
# below, so those lines are scanned like any root doc. km unreachable / gh missing = one WARN line, the build goes on.
if [ -f "$W/src/public/root/CHANGELOG.md" ]; then
  cp "$W/src/public/root/CHANGELOG.md" "$S/"
  python3 -I "$W/src/public/km-changelog.py" "$S/CHANGELOG.md" --notes "$W/release-notes.md" 2>&1 | sed 's/^/[make-public] /' \
    || step "km changelog: WARN helper failed — CHANGELOG as committed"
fi
# the bot operating rules (source moved here from ThisCode · ThisCodex · team-harness) — optional folder
if [ -d "$W/src/public/root/rules" ]; then
  [ -z "$(find "$W/src/public/root/rules" -type l)" ] || fail "symlink in public/root/rules (a link target can carry a local path)"
  cp -R "$W/src/public/root/rules" "$S/rules"
fi
# the «why SlackMod» page served by GitHub Pages from docs/ — optional folder · scanned below with the full table (no mask)
if [ -d "$W/src/public/root/docs" ]; then
  [ -z "$(find "$W/src/public/root/docs" -type l)" ] || fail "symlink in public/root/docs (a link target can carry a local path)"
  cp -R "$W/src/public/root/docs" "$S/docs"
fi

# 3. gates over the WHOLE tree — read through a scan view: the exact public link strings listed in
#    public/allowed-public-names.txt are masked in root *.md and rules/ only (nothing else is masked, nowhere else);
#    rules/ is scanned on its own with the identity classes only (its 설계 메모 section refs and template words such as
#    «internal» are the rules' own vocabulary) · every other folder keeps the full table.
V="$W/scanview"; cp -R "$S" "$V"
python3 -I "$W/src/public/mask-public-names.py" "$W/src/public/allowed-public-names.txt" "$V" || fail "name mask failed"
VR="$W/scanview-rules"; mkdir -p "$VR"; [ -d "$V/rules" ] && mv "$V/rules" "$VR/rules"
step "scan (port/scan-traces.sh over the whole tree but rules/)"
bash "$W/src/port/scan-traces.sh" --table "$W/src/port/lib/traces.tsv" "$V" >"$W/scan.txt" 2>&1 || { cat "$W/scan.txt" >&2; fail "trace scan not clean"; }
tail -1 "$W/scan.txt"
if [ -d "$VR/rules" ]; then
  awk -F'\t' '$1 != "SPEC" && !($1 == "TERM" && $2 == "i")' "$W/src/port/lib/traces.tsv" > "$W/rules-traces.tsv"
  step "scan rules/ (identity classes: secrets · bots · owner · paths · hosts · team · ids · ledger · child ids)"
  bash "$W/src/port/scan-traces.sh" --table "$W/rules-traces.tsv" "$VR" >"$W/scan-rules.txt" 2>&1 || { cat "$W/scan-rules.txt" >&2; fail "trace scan not clean (rules/)"; }
  tail -1 "$W/scan-rules.txt"
fi
rm -rf "$V" "$VR"
# user-facing copy: no in-house jargon (porting rule 설계 메모) — root docs + setup/ markdown
JARGON='정본|환류|린팅|발주|오케스트레이터|SoT|볼트 마스터|하위 봇'
jh="$( { find "$S" -maxdepth 1 -name '*.md' -type f -print0 | xargs -0 grep -n -E "$JARGON" 2>/dev/null
         if [ -d "$S/setup" ]; then find "$S/setup" -name '*.md' -type f -print0 | xargs -0 grep -n -E "$JARGON" 2>/dev/null; fi
         true; } )"
if [ -n "$jh" ]; then
  echo "$jh" | sed "s|$S/||" | head -10 >&2; fail "in-house jargon in user-facing copy"
fi
step "jargon check (root + setup markdown): 0"
n=0; while IFS= read -r -d '' f; do bash -n "$f" || fail "bash -n: ${f#$S/}"; n=$((n+1)); done < <(find "$S" -name '*.sh' -type f -print0)
step "bash -n: $n files ok"
n=0; while IFS= read -r -d '' f; do python3 -m py_compile "$f" 2>/dev/null || fail "py_compile: ${f#$S/}"; n=$((n+1)); done < <(find "$S" -name '*.py' -type f ! -path '*/node_modules/*' -print0)
find "$S" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
step "python compile: $n files ok"
if [ -d "$S/setup" ]; then
  n=0; while IFS= read -r -d '' f; do node --check "$f" || fail "node --check: ${f#$S/}"; n=$((n+1)); done < <(find "$S/setup" \( -name '*.js' -o -name '*.mjs' \) -type f -print0)
  step "node --check (setup): $n files ok"
  claude plugin validate "$S/setup" >"$W/validate-setup.txt" 2>&1 || { cat "$W/validate-setup.txt" >&2; fail "plugin validate: setup/"; }
  step "plugin validate setup/: passed"
fi
claude plugin validate "$S/slackmod/app/mods-harness" >"$W/validate-mod.txt" 2>&1 || { cat "$W/validate-mod.txt" >&2; fail "plugin validate: mods-harness"; }
step "plugin validate slackmod/app/mods-harness: passed"

# 4. fresh git, one commit under the FIXED public identity (never the builder's git config · signing · time zone), no remote
IFS=$'\t' read -r PUB_NAME PUB_EMAIL < <(bash "$HERE/check-public-meta.sh" --identity)
PUB_DATE="$(TZ=UTC date -R)"
git -C "$S" init -q -b main
git -C "$S" add -A
GIT_AUTHOR_NAME="$PUB_NAME" GIT_AUTHOR_EMAIL="$PUB_EMAIL" GIT_COMMITTER_NAME="$PUB_NAME" GIT_COMMITTER_EMAIL="$PUB_EMAIL" \
GIT_AUTHOR_DATE="$PUB_DATE" GIT_COMMITTER_DATE="$PUB_DATE" \
  git -C "$S" -c commit.gpgsign=false commit -q -m "SlackMod preview (${SHA:0:7} · bridge ${TC_SHA:0:7})"
[ "$(git -C "$S" rev-list --count HEAD)" = 1 ] || fail "expected exactly one commit"
[ -z "$(git -C "$S" remote)" ] || fail "a remote exists"
# 5. the tarball = the committed files only (git archive: no .git, no builder user/group names) → metadata gate → only then anything lands in <out>
git -C "$S" archive --format=tar --prefix="$NAME/" HEAD | gzip -n > "$W/$NAME.tar.gz"
bash "$HERE/check-public-meta.sh" "$S" "$W/$NAME.tar.gz" || fail "metadata check failed (.git 0 · 작성자 신원 0)"
rm -rf "${OUT:?}/$NAME"
cp -R "$S" "$OUT/$NAME"
cp "$W/$NAME.tar.gz" "$OUT/$NAME.tar.gz"
( cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
# the GitHub release body for this preview (lines only — this script never makes a release): the km lines added in this build
[ -s "$W/release-notes.md" ] && cp "$W/release-notes.md" "$OUT/$NAME.release-notes.md"
step "built $OUT/$NAME · commit $(git -C "$OUT/$NAME" rev-parse --short HEAD) · files $(git -C "$OUT/$NAME" ls-files | wc -l | tr -d ' ') · tar $(cut -c1-16 "$OUT/$NAME.tar.gz.sha256")"
