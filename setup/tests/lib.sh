#!/usr/bin/env bash
# lib.sh — shared helpers for setup/tests/*.sh (sourced, never run). bash 3.2 safe.
# Every test works inside mktemp dirs: a throwaway HOME and a throwaway «bundle» built from port/ + stub app/ folders
# (the real app/ comes from make-bundle; its heavy build is not needed to test the installer's own logic).
SETUP_TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SETUP_TESTS_DIR/../.." && pwd -P)"
PORT_DIR="$REPO_ROOT/port"
SETUP_DIR="$REPO_ROOT/setup"
BASHX=/bin/bash; [ -x "$BASHX" ] || BASHX=bash   # the tests run the scripts under bash 3.2 (macOS /bin/bash) when it exists
FAIL=0
PASSN=0
NOTEST_SKIP=0
ok() { PASSN=$((PASSN + 1)); echo "PASS $1"; }
no() { FAIL=1; echo "FAIL $1"; }
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
mk_tmp() { local b="${TMPDIR:-/tmp}"; mktemp -d "${b%/}/$1.XXXXXX"; }   # (no «//» in the path: tools that normalize paths must agree with the tests)

# listing <dir> → sorted «path mode sha» lines (files) and «path» lines (dirs) — the fingerprint tests compare
listing() {
  ( cd "$1" && find . -mindepth 1 -print | LC_ALL=C sort | while IFS= read -r f; do
      if [ -L "$f" ]; then printf '%s -> %s\n' "$f" "$(readlink "$f")"
      elif [ -f "$f" ]; then printf '%s %s %s\n' "$f" "$(mode_of "$f")" "$(sha_of "$f" | cut -c1-16)"
      else printf '%s\n' "$f"; fi
    done )
}

# make_bundle <dir> [port-dir] → a bundle tree shaped like the customer zip: install.sh · bin · lib · hooks · templates ·
# config.example.json at the top, a stub app/mods-harness and app/channel-server below (enough for install.sh's checks).
make_bundle() {
  local b="$1" p="${2:-$PORT_DIR}"
  mkdir -p "$b/bin" "$b/lib" "$b/hooks" "$b/templates" "$b/app/mods-harness/src" "$b/app/channel-server/dist"
  cp "$p/install.sh" "$b/install.sh"; chmod 755 "$b/install.sh"
  cp "$p/bin/slackmod" "$b/bin/slackmod"; chmod 755 "$b/bin/slackmod"
  cp "$p/lib/slackmod_config.py" "$p/lib/route_judge.py" "$b/lib/"
  [ -f "$p/lib/record.py" ] && cp "$p/lib/record.py" "$b/lib/"
  [ -f "$p/lib/rooms.py" ] && cp "$p/lib/rooms.py" "$b/lib/"
  cp "$p/hooks/pass.sh" "$b/hooks/"; chmod 755 "$b/hooks/pass.sh"
  cp "$p/templates/main-contract.md" "$p/templates/main-contract-solo.md" "$b/templates/"
  [ -d "$p/templates/starter-wiki" ] && cp -R "$p/templates/starter-wiki" "$b/templates/"
  [ -d "$p/templates/skills" ] && cp -R "$p/templates/skills" "$b/templates/"
  cp "$p/config.example.json" "$b/"
  printf '{"name":"stub-mods"}\n' > "$b/app/mods-harness/package.json"
  printf '// stub\n' > "$b/app/mods-harness/src/index.js"
  printf '{"lockfileVersion":3}\n' > "$b/app/channel-server/package-lock.json"
  printf '// stub bridge\n' > "$b/app/channel-server/dist/server.js"
  printf '// stub mcp\n' > "$b/app/channel-server/dist/mcp.js"
}

# fill_config <home> → fills the copied example config the way a person would (test ids · work dirs under HOME)
fill_config() {
  python3 -I - "$1" <<'PY'
import json, sys
h = sys.argv[1]; p = h + '/.slackmod/config.json'
c = json.load(open(p))
c['slack']['channel_id'] = 'CTESTCHAN01'; c['slack']['owner_user_id'] = 'UTESTUSER01'
c['bots'][0]['work_dir'] = h + '/bots/chonggwal'; c['bots'][1]['work_dir'] = h + '/bots/docbot'
json.dump(c, open(p, 'w'), indent=2, ensure_ascii=False)
PY
}

# make_public_tree <dir> <bundle.zip> — the public layout from a REAL bundle (make-bundle output): <dir>/slackmod/ = the unzipped
# bundle tree, next to it this checkout's setup/ and root install.sh (make-bundle packs port/ only).
make_public_tree() {
  local d="$1" z="$2" u b
  mkdir -p "$d"; u="$(mk_tmp unz)"
  ( cd "$u" && unzip -q "$z" ) || return 1
  b="$(ls -d "$u"/slackmod-*/ | head -1)"; b="${b%/}"
  mv "$b" "$d/slackmod"; rm -rf "$u"
  cp -R "$SETUP_DIR" "$d/setup"; rm -rf "$d/setup/tests"
  cp "$REPO_ROOT/install.sh" "$d/install.sh"; chmod 755 "$d/install.sh"
}

finish() { echo "rc=$FAIL · PASS $PASSN"; exit $FAIL; }
