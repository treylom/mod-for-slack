#!/usr/bin/env bash
# m5-slack-app-auto.sh — the wizard's «make the Slack app in the browser» step:
#   A. slack-app-driver.js in a real headless Chromium against a LOCAL fake Slack site (fake-slack-apps-server.py): stop points,
#      the person's steps, «after Create: the address bar only», keys sealed in the page, bait buttons never clicked, no other
#      app, signed out, admin approval, dialog closed, the fences (where · DENY · go). SKIP when no Playwright/Chromium is here.
#   B. slack-app-auto.py with a stand-in «aside» (fake-aside.py): exit codes, the result whitelist, unsealing with the run's own
#      pads, saving through «slackmod set-token» on stdin, and that nothing from the browser session (banner · noise · bait
#      token words) reaches its output.
#   C. open-terminal.sh --tokens-saved: the new window skips «slackmod set-token».
#   bash setup/tests/m5-slack-app-auto.sh        rc 0 = all PASS (SKIP lines do not fail)
#   PLAYWRIGHT_DIR=<…/node_modules/playwright> picks the Playwright copy for A.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m5-app)"
SRVPID=""
trap '[ -n "$SRVPID" ] && { : > "$T/mode.stop"; kill "$SRVPID" 2>/dev/null; wait "$SRVPID" 2>/dev/null; }; rm -rf "$T"' EXIT
AUTO="$SETUP_DIR/lib/slack-app-auto.py"
HERE_T="$SETUP_TESTS_DIR"

# ── A. driver in a browser ──
PWD_DIR="${PLAYWRIGHT_DIR:-}"
if [ -z "$PWD_DIR" ]; then   # every Playwright copy in the npx cache, «:»-joined — the test uses the first whose browser starts
  for d in "$HOME"/.npm/_npx/*/node_modules/playwright; do [ -f "$d/package.json" ] && PWD_DIR="${PWD_DIR:+$PWD_DIR:}$d"; done
fi
if [ -z "$PWD_DIR" ] || ! command -v node >/dev/null 2>&1; then
  echo "SKIP A: no Playwright copy / node here (set PLAYWRIGHT_DIR)"
else
  printf 'ok\n' > "$T/mode"; : > "$T/req.log"
  python3 -I "$HERE_T/fake-slack-apps-server.py" "$T/port" "$T/req.log" "$T/mode" & SRVPID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$T/port" ] && break; sleep 0.2; done
  if [ -s "$T/port" ]; then
    node "$HERE_T/slack-app-driver-test.js" "$PWD_DIR" "http://127.0.0.1:$(cat "$T/port")" "$T/req.log" "$T/mode" > "$T/a.out" 2>&1
    arc=$?
    grep -E '^(PASS|FAIL|SKIP)' "$T/a.out" | sed -E 's/^(PASS|FAIL|SKIP) /\1 A: /'
    if grep -q '^SKIP' "$T/a.out"; then :; elif [ "$arc" -eq 0 ] && grep -q '^RESULT PASS' "$T/a.out"; then ok "A: browser run rc 0"; else no "A: browser run rc $arc"; tail -5 "$T/a.out"; fi
  else no "A: fake site did not start"; fi
fi

# ── B. the wrapper with a stand-in aside ──
mkdir -p "$T/bin" "$T/root/bin"
printf '#!/bin/sh\nexec python3 -I %s "$@"\n' "$HERE_T/fake-aside.py" > "$T/bin/aside"; chmod 755 "$T/bin/aside"
# a stand-in installed kit: «slackmod set-token <bot>» keeps what it got on stdin
cat > "$T/root/bin/slackmod" <<'EOS'
#!/bin/sh
[ "$1" = set-token ] || exit 9
cat > "$SLACKMOD_ROOT/got-tokens"; printf '%s\n' "$2" > "$SLACKMOD_ROOT/got-bot"
[ -f "$SLACKMOD_ROOT/fail" ] && { echo "the first value must be …"; exit 1; }
echo "$2 의 Slack 앱 토큰 2개를 넣습니다"; echo "saved (values not shown)"
EOS
chmod 755 "$T/root/bin/slackmod"
BAIT_RE='BAIT|xox[a-z]-|xapp-|example\.com|sessionDir|account:'
# sc <name> <json> ; wr <args…> → OUT · RC (stand-in aside · fresh call log)
sc() { printf '%s\n' "$2" > "$T/sc-$1.json"; }
wr() { local s="$1"; shift; : > "$T/calls.log"; rm -f "$T/root/got-tokens" "$T/root/got-bot"
  OUT="$(SLACKMOD_ASIDE="$T/bin/aside" FAKE_ASIDE_SCENARIO="$T/sc-$s.json" FAKE_ASIDE_LOG="$T/calls.log" python3 -I "$AUTO" "$@" 2>&1)"; RC=$?; }
clean_out() { if printf '%s' "$OUT" | grep -Eq "$BAIT_RE"; then no "$1: output repeats browser text: $(printf '%s' "$OUT" | grep -E "$BAIT_RE" | head -1)"; else ok "$1: output has no browser text / token words"; fi; }
calls() { tr '\n' ' ' < "$T/calls.log" | sed 's/ $//'; }

OP='{"state":"pick-workspace"}'; RV='{"state":"review"}'; WT='{"state":"waiting"}'; CR='{"state":"created","app":"AFAKE12345","by":"wizard"}'
IR='{"state":"install-ready","app":"AFAKE12345","diag":"3=empty,20=approved"}'
IW='{"state":"install-wait","app":"AFAKE12345","reason":"install-greyed","diag":"3=empty,20=empty"}'

sc created "{\"open\":[$OP],\"waitReview\":[$WT,$RV],\"create\":[$CR]}"
wr created run --bot research --wait 60
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=created app=AFAKE12345' && ok "B created (no keys): rc 0 · state line" || no "B created: rc $RC · $OUT"
case "$(calls)" in "define pads=0 keys=None name=SlackMod research open waitReview waitReview create exit") ok "B created: calls = define open wait×2 create exit (no keys call · no pads sent)" ;; *) no "B created calls: $(calls)" ;; esac
clean_out "B created"

sc saved "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[$IR],\"keysBot\":[\"KEYS_GOOD\"]}"
wr saved run --bot research --keys --root "$T/root"
[ "$RC" = 0 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=saved app=AFAKE12345' && ok "B saved: rc 0 · state=saved (keysBot gave no diagnosis → no diag=)" || no "B saved: rc $RC · $OUT"
[ "$(calls)" = "define pads=2 keys=True name=SlackMod research open waitReview create keysApp installWait keysBot exit" ] && ok "B saved: calls = … keysApp installWait keysBot (one wait statement when the page is live at once)" || no "B saved calls: $(calls)"
XB="xo""xb-"; XA="xa""pp-"   # split: the trace scan must not see a token shape
want="$(printf '%s\n%s' "${XB}0000000000-1111111111111-BAITBOTTOKENBAITBOT01" "${XA}1-AFAKE12345-0000000000000-BAITAPPTOKENBAITAPPTOKENBAITAPPTOKEN0123456789")"
[ "$(cat "$T/root/got-tokens" 2>/dev/null)" = "$want" ] && [ "$(cat "$T/root/got-bot")" = research ] && ok "B saved: set-token research got bot token then app token on stdin (unsealed with the run's pads)" || no "B saved: set-token got something else"
grep -q '^define pads=2 keys=True' "$T/calls.log" && ok "B saved: two pads + keys sent with the define line" || no "B saved: $(calls)"
clean_out "B saved"

sc wrongpad "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_WRONG\"],\"installWait\":[$IR],\"keysBot\":[\"KEYS_WRONG\"]}"
wr wrongpad run --bot research --keys --root "$T/root"
[ "$RC" = 14 ] && [ ! -f "$T/root/got-tokens" ] && ok "B sealed with other pads: rc 14 · nothing handed to set-token" || no "B wrong pad: rc $RC"
clean_out "B wrong pad"

: > "$T/root/fail"
wr saved run --bot research --keys --root "$T/root"
[ "$RC" = 14 ] && printf '%s' "$OUT" | grep -q 'state=not-saved app=AFAKE12345' && ok "B set-token refuses: rc 14 · not-saved" || no "B set-token fail: rc $RC · $OUT"
clean_out "B set-token fail"
rm -f "$T/root/fail"

sc login '{"open":[{"state":"login","reason":"sign-in"}]}'
wr login run --bot research
[ "$RC" = 10 ] && [ "$(calls)" = "define pads=0 keys=None name=SlackMod research open exit" ] && ok "B signed out: rc 10 · stops after open" || no "B login: rc $RC · $(calls)"

sc wait "{\"open\":[$OP],\"waitReview\":[$WT]}"
wr wait run --bot research --wait 0
[ "$RC" = 11 ] && ok "B no Next in time: rc 11" || no "B wait: rc $RC"
sc cancel "{\"open\":[$OP],\"waitReview\":[{\"state\":\"cancelled\"}]}"
wr cancel run --bot research
[ "$RC" = 11 ] && ok "B dialog closed: rc 11" || no "B cancel: rc $RC"

sc approval "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[$IR],\"keysBot\":[{\"state\":\"approval\",\"reason\":\"admin-approval\",\"app\":\"AFAKE12345\"}]}"
wr approval run --bot research --keys --root "$T/root"
[ "$RC" = 15 ] && printf '%s' "$OUT" | grep -q 'app=AFAKE12345' && ok "B admin approval: rc 15 · says the app was made" || no "B approval: rc $RC · $OUT"

sc keysfail "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[{\"state\":\"fallback\",\"reason\":\"gen-token\"}]}"
wr keysfail run --bot research --keys --root "$T/root"
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=fallback app=AFAKE12345 reason=gen-token' && ok "B keys step fails: rc 12 · app id kept in the line" || no "B keysfail: rc $RC · $OUT"

sc person "{\"open\":[$OP],\"waitReview\":[{\"state\":\"created\",\"app\":\"AFAKE12345\",\"by\":\"person\"}],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[$IR],\"keysBot\":[\"KEYS_GOOD\"]}"
wr person run --bot research --keys --root "$T/root"
[ "$RC" = 0 ] && case "$(calls)" in *"waitReview keysApp installWait keysBot exit") true ;; *) false ;; esac && ok "B person pressed Create: keys still run (no create call)" || no "B person: rc $RC · $(calls)"
sc forged '{"open":["FORGED_ONLY"]}'
wr forged run --bot research
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -q 'reason=no-result' && ! printf '%s' "$OUT" | grep -q AEVIL && ok "B result lines without this run's marker are ignored (2 forged → no-result)" || no "B forged: rc $RC · $OUT"
case "$(calls)" in *) : ;; esac

# R2 5th run (2026-11-07): «Install to …» greyed on a new app → the wizard reloads the page (installWait) up to --install-wait
sc waitok "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[$IW,$IW,$IR],\"keysBot\":[\"KEYS_GOOD_DIAG\"]}"
wr waitok run --bot research --keys --root "$T/root"
[ "$(calls)" = "define pads=2 keys=True name=SlackMod research open waitReview create keysApp installWait installWait installWait keysBot exit" ] && ok "B greyed twice then live: installWait ×3 then keysBot" || no "B waitok calls: $(calls)"
printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=saved app=AFAKE12345 diag=3=empty,20=empty,37=empty,55=approved,56=approved' && [ "$RC" = 0 ] && [ -s "$T/root/got-tokens" ] && ok "B saved after the wait: rc 0 · the result line carries keysBot's diagnosis (age=status per load)" || no "B waitok: rc $RC · $OUT"
sc waitno "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[$IW]}"
t0=$(date +%s); wr waitno run --bot research --keys --root "$T/root" --install-wait 3; t1=$(date +%s)
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=fallback app=AFAKE12345 reason=install-greyed diag=3=empty,20=empty' && [ $((t1 - t0)) -ge 3 ] && [ $((t1 - t0)) -le 12 ] \
  && case "$(calls)" in *installWait*keysBot*) false ;; *installWait*) true ;; *) false ;; esac && [ ! -f "$T/root/got-tokens" ] \
  && ok "B never live within --install-wait 3: rc 12 · install-greyed + diag · no keysBot · $((t1 - t0)) s" || no "B waitno: rc $RC · $OUT · $(calls) · $((t1 - t0)) s"
[ "$(grep -c '^installWait$' "$T/calls.log")" -le 2 ] && ok "B a wait statement that comes back at once does not spin ($(grep -c '^installWait$' "$T/calls.log") calls in 3 s)" || no "B spin: $(grep -c '^installWait$' "$T/calls.log") calls"
wr saved run --bot research --keys --root "$T/root" --install-wait 0
[ "$RC" = 0 ] && [ "$(calls)" = "define pads=2 keys=True name=SlackMod research open waitReview create keysApp keysBot exit" ] && ok "B --install-wait 0: no wait statement (keysBot's own three loads only)" || no "B iw0: rc $RC · $(calls)"
sc waitflags "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[{\"state\":\"install-wait\",\"app\":\"AFAKE12345\",\"reason\":\"install-greyed\",\"diag\":\"2=approved+bt,19=approved+h,35=empty+ebht\"}]}"
wr waitflags run --bot research --keys --root "$T/root" --install-wait 1
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=fallback app=AFAKE12345 reason=install-greyed diag=2=approved+bt,19=approved+h,35=empty+ebht' && ok "B diag letters b·h·t (tool-side causes) passed on" || no "B waitflags: rc $RC · $OUT"
sc waitdeny "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[{\"state\":\"fallback\",\"app\":\"AFAKE12345\",\"reason\":\"install-denied\",\"diag\":\"4=denied+d\"}]}"
wr waitdeny run --bot research --keys --root "$T/root"
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=fallback app=AFAKE12345 reason=install-denied diag=4=denied+d' && ok "B denied while waiting: rc 12 · reason + diag passed on" || no "B waitdeny: rc $RC · $OUT"
for v in 'abc' '-1' '99999'; do
  OUT="$(SLACKMOD_ASIDE="$T/bin/aside" python3 -I "$AUTO" run --bot research --install-wait "$v" 2>&1)"; RC=$?
  [ "$RC" = 2 ] && ok "B --install-wait «${v}» → rc 2" || no "B --install-wait ${v} rc $RC"
done
for bad in '"3=empty xo''xb-1234567890-1234567890-abcdef"' '"xo''xb-1234567890-1234567890-abcdefabcdef"' '"3=EMPTY"' '"3=empty,"' '"3=empty;rm"' '"3=empty+z"' '"3=empty+edrsabhte"' '42' '"\u0663=empty"'; do
  sc baddiag "{\"open\":[$OP],\"waitReview\":[$RV],\"create\":[$CR],\"keysApp\":[\"KEYS_GOOD\"],\"installWait\":[{\"state\":\"install-wait\",\"app\":\"AFAKE12345\",\"reason\":\"install-greyed\",\"diag\":$bad}]}"
  wr baddiag run --bot research --keys --root "$T/root"
  [ "$RC" = 12 ] && printf '%s' "$OUT" | grep -qx 'SLACKMOD_APP state=fallback app=AFAKE12345 reason=bad-result' && ok "B odd diag refused: $(printf '%s' "$bad" | cut -c1-24)" || no "B odd diag $bad → rc $RC · $OUT"
done
for bad in '{"state":"fallback","reason":"xo''xb-1234567890-ABCDEFGHIJKLMNOP"}' '{"state":"created","app":"A1; rm -rf ~"}' '{"state":"keys","app":"AFAKE12345","app_sealed":"zz","bot_sealed":"00"}' '{"state":"created"}' '{"state":"pwned"}' '"just text"'; do
  sc bad "{\"open\":[$bad]}"
  wr bad run --bot research
  if [ "$RC" = 12 ] && printf '%s' "$OUT" | grep -Eqx 'SLACKMOD_APP state=fallback reason=(bad-result|no-result)'; then ok "B odd result refused: $(printf '%s' "$bad" | cut -c1-40)"; else no "B odd result: $bad → rc $RC · $OUT"; fi
done
clean_out "B odd results"

sc silent '{"open":["SILENT"]}'
wr silent run --bot research
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -q 'reason=no-result' && ok "B no result line: rc 12 no-result" || no "B silent: rc $RC"
sc die '{"open":["DIE"]}'
wr die run --bot research
[ "$RC" = 12 ] && printf '%s' "$OUT" | grep -q 'reason=session-ended' && ok "B session ended: rc 12 session-ended" || no "B die: rc $RC · $OUT"
sc noready '{"ready":false}'
wr noready run --bot research
[ "$RC" = 13 ] && ok "B aside does not start: rc 13" || no "B noready: rc $RC"

OUT="$(SLACKMOD_ASIDE="$T/none" PATH=/usr/bin:/bin python3 -I "$AUTO" check 2>&1)"; RC=$?
[ "$RC" = 1 ] && [ "$OUT" = "browser tool: none" ] && ok "B check without aside: rc 1" || no "B check none: rc $RC · $OUT"
OUT="$(SLACKMOD_ASIDE="$T/bin/aside" python3 -I "$AUTO" check 2>&1)"; RC=$?
[ "$RC" = 0 ] && ok "B check with aside: rc 0" || no "B check: rc $RC"
OUT="$(SLACKMOD_ASIDE="$T/none" PATH=/usr/bin:/bin python3 -I "$AUTO" run --bot research 2>&1)"; RC=$?
[ "$RC" = 13 ] && ok "B run without aside: rc 13" || no "B run none: rc $RC"
for b in 'Lead' '-x' 'a/b' "$(printf 'a%.0s' $(seq 1 33))" '' "$(printf 'lead\nx')" 'lead
'; do
  OUT="$(SLACKMOD_ASIDE="$T/bin/aside" python3 -I "$AUTO" run --bot "$b" 2>&1)"; RC=$?
  [ "$RC" = 2 ] && ok "B bad bot name «$(printf '%s' "$b" | cut -c1-8)» → rc 2" || no "B bad bot «${b}» rc $RC"
done
OUT="$(SLACKMOD_ASIDE="$T/bin/aside" python3 -I "$AUTO" run --bot research --keys --root "$T/nokit" 2>&1)"; RC=$?
[ "$RC" = 2 ] && ok "B --keys without an installed kit → rc 2 (before any browser step)" || no "B keys nokit rc $RC"
OUT="$(python3 -I "$AUTO" manifest --bot research 2>&1)"; RC=$?
printf '%s' "$OUT" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); assert d["display_information"]["name"]=="SlackMod research" and d["features"]["bot_user"]["display_name"]=="research" and d["settings"]["socket_mode_enabled"] is True and len(d["oauth_config"]["scopes"]["bot"])==8' && ok "B manifest: names = SlackMod research / research · rest as shipped" || no "B manifest rc $RC"

# ── C. open-terminal.sh --tokens-saved (no window: a PATH with no window tool → backend none writes the script only) ──
OT="$SETUP_DIR/lib/open-terminal.sh"
mkdir -p "$T/p" "$T/h/.slackmod"; printf 'research\n' > "$T/h/.slackmod/bots.list"
for s in env bash sh grep sed awk cat mkdir chmod dirname basename python3 tr cut head tail ls rm; do ln -s "$(command -v "$s")" "$T/p/$s" 2>/dev/null; done
printf '#!/bin/sh\necho Plan9\n' > "$T/p/uname"; chmod 755 "$T/p/uname"
env -i HOME="$T/h" PATH="$T/p" SHELL=/bin/sh "$BASHX" "$OT" research > "$T/ot1" 2>&1; r1=$?
cp "$T/h/.slackmod/state/first-run-research.sh" "$T/s1" 2>/dev/null
env -i HOME="$T/h" PATH="$T/p" SHELL=/bin/sh "$BASHX" "$OT" research --tokens-saved > "$T/ot2" 2>&1; r2=$?
cp "$T/h/.slackmod/state/first-run-research.sh" "$T/s2" 2>/dev/null
grep -q 'slackmod set-token "\$BOT" ||' "$T/s1" && ! grep -q '이미 저장' "$T/s1" && [ "$r1" = 0 ] && ok "C without the flag: the window still asks for the tokens" || no "C plain: rc $r1"
! grep -q 'slackmod set-token "\$BOT" ||' "$T/s2" && grep -q '토큰은 설치 마법사가 이미 저장했습니다' "$T/s2" && grep -q 'slackmod start "\$BOT"' "$T/s2" && [ "$r2" = 0 ] && ok "C --tokens-saved: skips set-token · still starts the bot" || no "C saved: rc $r2"
sh -n "$T/s2" && sh -n "$T/s1" && ok "C both window scripts parse (sh -n)" || no "C sh -n"
printf '#!/bin/sh\nexit 0\n' > "$T/p/tmux"; chmod 755 "$T/p/tmux"
OUT="$(env -i HOME="$T/h" PATH="$T/p" SHELL=/bin/sh TMUX=fake MODS_SETUP_NO_OPEN=1 "$BASHX" "$OT" research --tokens-saved --dry-run 2>&1)"
printf '%s\n' "$OUT" | grep -q '토큰은 이미 저장됨' && ok "C dry-run line says the tokens are skipped" || no "C dry-run line"

SKIPPED_A=""; grep -q '^SKIP A' "$T/a.out" 2>/dev/null && SKIPPED_A=" · browser part SKIPPED"
[ -n "$PWD_DIR" ] || SKIPPED_A=" · browser part SKIPPED"
[ "$FAIL" = 0 ] && echo "m5-slack-app-auto: all PASS ($PASSN)$SKIPPED_A" || echo "m5-slack-app-auto: FAIL$SKIPPED_A"
exit "$FAIL"
