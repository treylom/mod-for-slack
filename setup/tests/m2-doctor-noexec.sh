#!/usr/bin/env bash
# m2-doctor-noexec.sh — the health check runs nothing a bot's launch.sh says (security round 2 ⑬ · re-review 10-26):
#   ① the REAL «slackmod status» does not source launch.sh (a command line in it leaves no marker) and still prints the bot row
#   ② the doctor with the REAL slackmod installed: a command in launch.sh is not executed (no marker) — [9] still has the row
#   ③ the doctor does not run the program launch.sh names as SM_CLAUDE (a script that writes a marker) — [2] still reads the
#      login through the claude on PATH
#   bash setup/tests/m2-doctor-noexec.sh        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m2-doctor-noexec)"
trap 'rm -rf "$T"' EXIT
REPO="$(cd "$SETUP_DIR/.." && pwd -P)"
R="$T/root"; H="$T/home"; B="$T/bin"; mkdir -p "$R/bin" "$R/lib" "$R/bots/alpha/slack" "$H" "$B" "$T/work/alpha"
cp "$REPO/port/bin/slackmod" "$R/bin/slackmod"; chmod 755 "$R/bin/slackmod"
cp "$REPO/port/lib/slackmod_config.py" "$R/lib/"
printf 'alpha\n' > "$R/bots.list"
printf 'SLACK_BOT_TOKEN=%s\nSLACK_APP_TOKEN=%s\nSLACK_CHANNEL_ID=CTEST000001\n' "xo""xb-1-AAAA" "xa""pp-1-AAAA" > "$R/bots/alpha/slack/.env"; chmod 600 "$R/bots/alpha/slack/.env"
# fake tool box: tmux = no server · claude = prints a logged-in status · the «evil» claude = writes a marker
printf '#!/bin/sh\nexit 1\n' > "$B/tmux"
printf '#!/bin/sh\n[ "$1 $2" = "auth status" ] && { echo "{\\"loggedIn\\": true, \\"authMethod\\": \\"claude.ai\\", \\"subscriptionType\\": \\"max\\"}"; exit 0; }\nexit 0\n' > "$B/claude"
printf '#!/bin/sh\nprintf ran > "%s"\nexit 0\n' "$T/marker-claude" > "$T/evil-claude"
chmod 755 "$B/tmux" "$B/claude" "$T/evil-claude"
# launch.sh: generator-shaped values + one command line in the middle (what an edited or swapped-in file could carry)
cat > "$R/bots/alpha/launch.sh" <<EOF
SM_BOT='alpha'
SM_WORK_DIR='$T/work/alpha'
SM_SLACK_DIR='$R/bots/alpha/slack'
printf ran > '$T/marker-launch'
SM_CLAUDE='$T/evil-claude'
EOF
PATHV="$B:/usr/bin:/bin"

# ① slackmod status
out="$(env -i HOME="$H" PATH="$PATHV" SLACKMOD_ROOT="$R" /bin/bash "$R/bin/slackmod" status 2>&1)"; rc=$?
if [ ! -e "$T/marker-launch" ] && printf '%s' "$out" | grep -q '^alpha '; then ok "① slackmod status: launch.sh not run (no marker) · row «$(printf '%s' "$out" | grep '^alpha ' | tr -s ' ')»"
else no "① slackmod status rc=$rc marker=$([ -e "$T/marker-launch" ] && echo yes || echo no) · $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; fi
rm -f "$T/marker-launch" "$T/marker-claude"

# ② + ③ the doctor (real slackmod in the install folder)
dout="$(env -i HOME="$H" PATH="$PATHV" SLACKMOD_ROOT="$R" SLACKMOD_DOCTOR_PS_FILE=/dev/null /bin/bash "$SETUP_DIR/lib/doctor.sh" 2>&1)"; drc=$?
[ ! -e "$T/marker-launch" ] && ok "② doctor: no command in launch.sh executed (no marker · doctor rc $drc)" || no "② doctor ran a launch.sh line (marker present)"
c2="$(printf '%s\n' "$dout" | grep ' · \[2\] ' | head -1)"
if [ ! -e "$T/marker-claude" ] && printf '%s' "$c2" | grep -q '^OK'; then ok "③ doctor: SM_CLAUDE from launch.sh not run (no marker) · [2] via PATH claude: ${c2%% · 할*}"
else no "③ marker=$([ -e "$T/marker-claude" ] && echo yes || echo no) · [2] $(printf '%s' "$c2" | cut -c1-160)"; fi
c9="$(printf '%s\n' "$dout" | grep ' · \[9\] ' | head -1)"
printf '%s' "$c9" | grep -q 'alpha' && ok "② [9] still reports the bot (status read without running launch.sh)" || no "② [9] row: $(printf '%s' "$c9" | cut -c1-160)"
finish
