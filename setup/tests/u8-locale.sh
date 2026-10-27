#!/usr/bin/env bash
# u8-locale.sh — macOS /bin/bash 3.2 under a UTF-8 locale reads the first byte of a multibyte character that directly
# follows «$name» as part of the name («$bt·$at» → «bt\xc2: unbound variable» with set -u, an empty value without it).
# A user's terminal is almost always UTF-8, so every shipped shell file must brace such names («${bt}·${at}»).
#   ① static: shipped shell files (setup/lib · port/bin · port/lib · port/install.sh · install.sh) have 0 «$name<non-ASCII>»
#      outside single quotes ② doctor.sh under LANG=en_US.UTF-8 in a throwaway HOME prints no «unbound variable».
# Prints PASS/FAIL lines · rc 0 = all PASS.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; REPO="$(cd "$HERE/../.." && pwd -P)"
BASHX=/bin/bash; [ -x "$BASHX" ] || BASHX=bash
fails=0; ok() { echo "PASS $*"; }; no() { echo "FAIL $*"; fails=$((fails + 1)); }
hits="$(python3 -I - "$REPO" <<'PY'
import os, re, sys
repo = sys.argv[1]
pat = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7f])')
roots = ['setup/lib', 'port/bin', 'port/lib', 'port/install.sh', 'install.sh']
files = []
for r in roots:
    p = os.path.join(repo, r)
    if os.path.isfile(p): files.append(p)
    elif os.path.isdir(p):
        for d, _, fs in os.walk(p):
            for f in fs:
                q = os.path.join(d, f)
                try: head = open(q, 'rb').readline()
                except OSError: continue
                if f.endswith('.sh') or (head.startswith(b'#!') and b'sh' in head): files.append(q)
for q in files:
    try: lines = open(q, encoding='utf-8').read().split('\n')
    except (UnicodeDecodeError, OSError): continue
    for i, l in enumerate(lines, 1):
        if l.lstrip().startswith('#'): continue
        for m in pat.finditer(l):
            if l[:m.start()].count("'") % 2: continue   # inside single quotes = not expanded
            print(f'{os.path.relpath(q, repo)}:{i}  ${m.group(1)}')
PY
)"
n="$(printf '%s' "$hits" | grep -c . || true)"
if [ "$n" = 0 ]; then ok "static: shipped shell files have 0 «\$name<non-ASCII>» outside single quotes"
else no "static: ${n} unbraced \$name directly before a non-ASCII character:"; printf '%s\n' "$hits" | head -10 | sed 's/^/    /'; fi
D="$REPO/setup/lib/doctor.sh"; CFG="$REPO/port/lib/slackmod_config.py"
if [ -f "$D" ] && [ -f "$CFG" ]; then
  # minimal install so the per-bot loops run (an empty HOME skips them and could never fail): bin/slackmod · bots.list ·
  # one bot with an empty token file · the real config helper (the token cell reads it)
  H="$(mktemp -d "${TMPDIR:-/tmp}/u8-locale.XXXXXX")"; H="$(cd "$H" && pwd -P)"; R="$H/.slackmod"
  mkdir -p "$R/bin" "$R/lib" "$R/bots/alpha/slack"
  printf '#!/bin/sh\nexit 0\n' > "$R/bin/slackmod"; chmod 755 "$R/bin/slackmod"
  printf 'alpha\n' > "$R/bots.list"; cp "$CFG" "$R/lib/"
  printf 'SLACK_BOT_TOKEN=\nSLACK_APP_TOKEN=\n' > "$R/bots/alpha/slack/.env"; chmod 600 "$R/bots/alpha/slack/.env"
  out="$(env -i HOME="$H" PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
         "$BASHX" "$D" 2>&1)"
  if printf '%s' "$out" | grep -q 'unbound variable'; then no "doctor.sh under en_US.UTF-8 (1 bot): $(printf '%s' "$out" | grep -m1 'unbound variable' | cut -c1-120)"
  elif printf '%s' "$out" | grep -q '\[3\] '; then ok "doctor.sh under en_US.UTF-8 (1 bot): token cell ran · no «unbound variable» · $(printf '%s\n' "$out" | grep -m1 '^요약:')"
  else no "doctor.sh under en_US.UTF-8 (1 bot): token cell [3] never ran — the fixture no longer reaches it"; fi
else ok "doctor.sh or config helper absent — skipped"; fi
[ "$fails" = 0 ]
