#!/usr/bin/env bash
# m1-plan-install.sh — port/install.sh --plan FILE: the wizard's setup.json → config.json → the same install, no hand-filled config.
#   ① --plan installs (rc 0 · config.json made · zsh aliases · harness.json per bot) ② again = «바뀜 0» + files unchanged
#   ③ --plan --dry-run writes nothing ④ bad bot name → rc 2, nothing written, the field is named
#   ⑤ secret column / secret-shaped value → rc 2, the bait string never printed, never in config.json
#   ⑥ slack skipped (enabled false) installs with empty ids ⑦ blank mode (0 bots) installs, PATH only, twice = 바뀜 0
#   ⑧ guests → bot .env ALLOWED_SLACK_GUEST_IDS (list = key · empty = no active key · stale key removed · bad id → rc 2)
#   ⑨ mux → harness.json window_backend (herdr · tmux · cmux→tmux · auto/orca = key absent)
#   ⑩ re-plan keeps what the setup file has no column for (aliases · child · notices) and backs up the old config
#   ⑪ bot-name length edges 1 / 32 pass · 33 / uppercase / leading digit → rc 2 ⑫ old no-plan path unchanged (example copy → rc 4)
#   ⑬ children (하위 세션 쓰기) false → harness.json session.children false + launch.sh SM_CONTRACT = contract-solo.md (both
#      contract files installed) · true / absent → no key, contract.md · not a boolean → rc 2, names children
#   ⑭ router (하위 라우터) on + bundled → session.jev_route (judge argv + --key-file <bot>/slack/route-judge.key) + lib/route_judge.py ·
#      no launch.sh name (sec r6 ⓑ2) · the key bait (slackmod set-judge-key: key file 1× 0600 · .env / install / status / doctor /
#      config / harness / launch = 0×) · own command · off / children false / absent = no key · bad mode → rc 2
#   ⑮ gate file pin: pass.sh edited → doctor [13] 주의 + the fix line · install.sh again = original back, edit in the backup, pin
#      rewritten, [13] OK, then 바뀜 0 · a kit update with a new pass.sh → re-pinned to the new original
#   bash setup/tests/m1-plan-install.sh          Works in throwaway HOMEs. rc 0 = all PASS.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
T="$(mk_tmp m1-plan)"
trap 'rm -rf "$T"' EXIT
B="$T/bundle"; make_bundle "$B"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/plan-lib.sh"
BAIT_BOT="xoxb-""999999999999-888888888888-BAITBAITBAITBAITBAIT"
BAIT_KEY="sk-""BAITBAITBAITBAITBAITBAIT"

# ① positive
new_home; mk_setup "$T/s1.json"
plan_run "$T/s1.json"
if [ $RC -eq 0 ] && [ -f "$H/.slackmod/config.json" ] && [ "$(mode_of "$H/.slackmod/config.json")" = 644 ] \
   && grep -q '^alias lead=' "$H/.zshrc" && [ -f "$H/.slackmod/bots/lead/harness.json" ] && [ -f "$H/.slackmod/bots/watch/slack/.env" ] \
   && [ "$(cfg "d['bots'][0]['name'] + d['bots'][1]['name'] + d['slack']['channel_id']")" = "leadwatchCTESTCHAN01" ]; then
  ok "① --plan: rc 0 · config.json (0644) from setup.json · aliases in ~/.zshrc · harness.json + .env per bot · $(count0 "$OUT")"
else no "① --plan rc=$RC"; printf '%s\n' "$OUT" | tail -6; fi
FP1="$(cat "$H/.slackmod/state/install.fp" 2>/dev/null)"
# ② twice = 바뀜 0
before="$(listing "$H" | grep -v 'state/install.fp')"
plan_run "$T/s1.json"
FP2="$(cat "$H/.slackmod/state/install.fp" 2>/dev/null)"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$FP1" = "$FP2" ] && [ -n "$FP1" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] \
  && ok "② --plan again: 바뀜 0 · fingerprint same (${FP2:0:16}) · files unchanged" || { no "② again rc=$RC $(count0 "$OUT") fp ${FP1:0:12}/${FP2:0:12}"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -6; }
# ③ dry-run on a fresh HOME writes nothing
new_home; mk_setup "$T/s3.json"
before="$(listing "$H")"
plan_run "$T/s3.json" --dry-run
[ $RC -eq 0 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q '미리 보기' && printf '%s' "$OUT" | grep -q 'config.json' \
  && ok "③ --plan --dry-run: rc 0 · HOME listing unchanged ($(listing "$H" | wc -l | tr -d ' ') entries) · plans the config.json write" || { no "③ dry-run rc=$RC"; printf '%s\n' "$OUT" | tail -5; }
# ④ bad bot name → rc 2, nothing written, field named
new_home; mk_setup "$T/s4.json" "d['bots'][0]['name'] = 'Lead_Bot'"
before="$(listing "$H")"
plan_run "$T/s4.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'bots\[0\].name' \
  && ok "④ bad bot name: rc 2 · nothing written · names bots[0].name" || { no "④ bad name rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
# ⑤ secrets: a secret column and a secret-shaped value are refused; the bait never shows up
new_home; mk_setup "$T/s5a.json" "d['slack']['bot_token'] = '$BAIT_BOT'"
before="$(listing "$H")"; plan_run "$T/s5a.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && ! printf '%s' "$OUT" | grep -q 'BAITBAIT' && printf '%s' "$OUT" | grep -q 'bot_token' \
  && ok "⑤a secret column (slack.bot_token): rc 2 · nothing written · bait not printed · column named" || { no "⑤a rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
new_home; mk_setup "$T/s5b.json" "d['bots'][0]['role'] = '$BAIT_KEY'"
before="$(listing "$H")"; plan_run "$T/s5b.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && ! printf '%s' "$OUT" | grep -q 'BAITBAIT' && printf '%s' "$OUT" | grep -q 'looks like a secret' \
  && ok "⑤b secret-shaped value (sk-…): rc 2 · nothing written · bait not printed" || { no "⑤b rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# the bait is in no installed file after a clean run either
new_home; mk_setup "$T/s5c.json"; plan_run "$T/s5c.json"
leak="$(grep -rhE 'xox[abprs]-|xapp-|sk-BAIT' "$H/.slackmod/config.json" "$H/.slackmod/bots" "$H/.zshrc" 2>/dev/null | grep -vc 'REPLACE-ME')"
[ "${leak:-1}" = 0 ] && ok "⑤c clean run: no token-shaped text in config.json · bot folders · rc file (only the REPLACE-ME placeholder lines)" || no "⑤c token-shaped text found ($leak lines)"
# ⑥ Slack skipped
new_home; mk_setup "$T/s6.json" "d['slack'] = {'enabled': False, 'channel_id': '', 'owner_user_id': '', 'guests': []}"
plan_run "$T/s6.json"
E6="$H/.slackmod/bots/lead/slack/.env"
[ $RC -eq 0 ] && [ "$(cfg "d['slack']['enabled']")" = "False" ] && ! grep -q '^ALLOWED_SLACK_USER_ID=' "$E6" && ! grep -q '^SLACK_CHANNEL_ID=' "$E6" \
  && [ "$(hjs lead "repr(d['slack']['home_channel'])")" = "''" ] \
  && ok "⑥ slack skipped: rc 0 · ids empty (no active ALLOWED_SLACK_USER_ID / SLACK_CHANNEL_ID line) · home_channel ''" || { no "⑥ slack skipped rc=$RC"; printf '%s\n' "$OUT" | tail -4; }
new_home; mk_setup "$T/s6n.json" "d['slack']['channel_id'] = ''"
plan_run "$T/s6n.json"
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q 'slack.channel_id' && ok "⑥b slack enabled but channel_id empty: rc 2 · names slack.channel_id" || { no "⑥b rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑦ blank mode
new_home; mk_setup "$T/s7.json" "d['mode'] = 'blank'; d['bots'] = []"
plan_run "$T/s7.json"
FPB="$(cat "$H/.slackmod/state/install.fp" 2>/dev/null)"
[ $RC -eq 0 ] && [ -f "$H/.slackmod/bots.list" ] && [ ! -s "$H/.slackmod/bots.list" ] && grep -q '# >>> slackmod >>>' "$H/.zshrc" && ! grep -q '^alias ' "$H/.zshrc" \
  && grep -q 'PATH=' "$H/.zshrc" && ok "⑦ blank mode: rc 0 · bots.list empty · rc block = PATH only (alias lines 0)" || { no "⑦ blank rc=$RC"; printf '%s\n' "$OUT" | tail -5; }
plan_run "$T/s7.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && ok "⑦b blank mode again: 바뀜 0" || { no "⑦b blank again rc=$RC $(count0 "$OUT")"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -4; }
new_home; mk_setup "$T/s7n.json" "d['bots'] = []"
plan_run "$T/s7n.json"
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q 'bots:' && ok "⑦c quick/full with 0 bots: rc 2 · names bots" || { no "⑦c rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑧ guests
new_home; mk_setup "$T/s8.json" "d['slack']['guests'] = ['UGUESTAAA01', 'UGUESTBBB02']"
plan_run "$T/s8.json"
EG="$H/.slackmod/bots/lead/slack/.env"; EG2="$H/.slackmod/bots/watch/slack/.env"
[ $RC -eq 0 ] && grep -qx 'ALLOWED_SLACK_GUEST_IDS=UGUESTAAA01,UGUESTBBB02' "$EG" && grep -qx 'ALLOWED_SLACK_GUEST_IDS=UGUESTAAA01,UGUESTBBB02' "$EG2" && [ "$(mode_of "$EG")" = 600 ] \
  && ok "⑧a guests list → both bot .env get ALLOWED_SLACK_GUEST_IDS=UGUESTAAA01,UGUESTBBB02 (0600)" || { no "⑧a guests rc=$RC"; grep -v TOKEN "$EG"; }
mk_setup "$T/s8e.json" "d['slack']['guests'] = []"
plan_run "$T/s8e.json"
[ $RC -eq 0 ] && ! grep -q 'ALLOWED_SLACK_GUEST_IDS' "$EG" \
  && ok "⑧b guests emptied: rc 0 · the stale ALLOWED_SLACK_GUEST_IDS line is gone (no key at all)" || { no "⑧b emptied rc=$RC"; grep -n GUEST "$EG"; }
new_home; mk_setup "$T/s8f.json"
plan_run "$T/s8f.json"
! grep -q 'ALLOWED_SLACK_GUEST_IDS' "$H/.slackmod/bots/lead/slack/.env" && ok "⑧c guests empty from the start: no ALLOWED_SLACK_GUEST_IDS in .env (not even a comment)" || no "⑧c key present"
new_home; mk_setup "$T/s8x.json" "d['slack']['guests'] = ['w0lowercase']"
before="$(listing "$H")"; plan_run "$T/s8x.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'slack.guests' && ok "⑧d bad guest id: rc 2 · nothing written · names slack.guests" || { no "⑧d rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
new_home; mk_setup "$T/s8o.json" "d['slack']['guests'] = ['UTESTUSER01']"
plan_run "$T/s8o.json"
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q 'owner' && ok "⑧e the owner listed as guest: rc 2" || { no "⑧e rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑨ mux → window_backend
for pair in herdr:herdr tmux:tmux cmux:tmux auto:ABSENT orca:ABSENT; do
  mux="${pair%%:*}"; want="${pair##*:}"
  new_home; mk_setup "$T/s9.json" "d['mux'] = '$mux'"
  plan_run "$T/s9.json"
  got="$(hjs lead "d.get('window_backend', 'ABSENT')")"
  [ $RC -eq 0 ] && [ "$got" = "$want" ] && ok "⑨ mux $mux → harness.json window_backend = $got" || { no "⑨ mux $mux → rc=$RC got $got want $want"; }
done
new_home; mk_setup "$T/s9x.json" "d['mux'] = 'screen'"
plan_run "$T/s9x.json"
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q 'mux' && ok "⑨x unknown mux: rc 2 · names mux" || { no "⑨x rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑬ children → session.children + the contract the launcher hands the bot
for pair in false:False:contract-solo.md true:ABSENT:contract.md absent:ABSENT:contract.md; do
  v="${pair%%:*}"; rest="${pair#*:}"; want="${rest%%:*}"; wantc="${rest##*:}"
  case "$v" in false) ex="d['children'] = False" ;; true) ex="d['children'] = True" ;; *) ex="d.pop('children', None)" ;; esac
  new_home; mk_setup "$T/s13.json" "$ex"
  plan_run "$T/s13.json"
  got="$(hjs lead "d['session'].get('children', 'ABSENT')" 2>&1)"; got2="$(hjs watch "d['session'].get('children', 'ABSENT')" 2>&1)"
  gotc="$(sed -n 's/^SM_CONTRACT=//p' "$H/.slackmod/bots/lead/launch.sh" 2>/dev/null | tr -d "'" | sed 's#.*/##')"
  [ $RC -eq 0 ] && [ "$got" = "$want" ] && [ "$got2" = "$want" ] && [ "$gotc" = "$wantc" ] && [ -s "$H/.slackmod/contract.md" ] && [ -s "$H/.slackmod/contract-solo.md" ] \
    && ok "⑬ children $v → session.children = $got (both bots) · launch SM_CONTRACT = $gotc · both contract files installed" \
    || { no "⑬ children $v → rc=$RC got $got/$got2 want $want · contract $gotc want $wantc"; printf '%s\n' "$OUT" | tail -3; }
done
new_home; mk_setup "$T/s13x.json" "d['children'] = 'no'"
plan_run "$T/s13x.json"
[ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q 'children' && ok "⑬x children 'no': rc 2 · names children" || { no "⑬x rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑭ router (하위 라우터 · 판정 모델이 고름) → session.jev_route · the bundled judge installed · its key FILE on its argv (--key-file) · no name on the launch line
jr14() { python3 -I -c '
import json, sys
h = json.load(open(sys.argv[1])); j = h["session"].get("jev_route")
print("ABSENT" if j is None else "%s|%s|%s|%s" % (j["mode"], j["argv"][0] == h["paths"]["pythonExecutable"], " ".join(j["argv"][1:]), j.get("timeout_ms")))' "$H/.slackmod/bots/$1/harness.json" 2>&1; }
dl14() { grep -c '^SM_EXTRA_ENV_DOTENV=' "$H/.slackmod/bots/$1/launch.sh"; }
new_home; mk_setup "$T/s14a.json" "d['router'] = {'mode': 'on', 'judge': 'bundled'}"
plan_run "$T/s14a.json"; OUT14="$OUT"
want="on|True|-I $H/.slackmod/lib/route_judge.py --key-file $H/.slackmod/bots/lead/slack/route-judge.key|5000"
wantw="on|True|-I $H/.slackmod/lib/route_judge.py --key-file $H/.slackmod/bots/watch/slack/route-judge.key|5000"
[ $RC -eq 0 ] && [ "$(jr14 lead)" = "$want" ] && [ "$(jr14 watch)" = "$wantw" ] && [ -s "$H/.slackmod/lib/route_judge.py" ] && [ "$(mode_of "$H/.slackmod/lib/route_judge.py")" = 644 ] \
  && [ "$(dl14 lead)" = 0 ] && ! grep -q 'ROUTE_JUDGE' "$H/.slackmod/bots/lead/launch.sh" "$H/.slackmod/bots/lead/slack/.env" && [ ! -e "$H/.slackmod/bots/lead/slack/route-judge.key" ] \
  && ok "⑭a router on + bundled → jev_route on · [python, -I, ~/.slackmod/lib/route_judge.py, --key-file, <bot>/slack/route-judge.key] · 5000 ms (each bot its own file) · judge installed 0644 · launch.sh names no judge key · no key file yet" \
  || { no "⑭a rc=$RC got $(jr14 lead) want $want · dotenv $(dl14 lead)"; printf '%s\n' "$OUT" | tail -3; }
# the key's bait cell: a fake key typed into «slackmod set-judge-key» lands in the bot's key file once (0600) and nowhere else
FAKEJ="sk-""ant-api00-JUDGEBAITJUDGEBAITJUDGEBAIT-0000"
SJ="$(printf '%s\n' "$FAKEJ" | env SHELL=/bin/zsh HOME="$H" "$BASHX" "$H/.slackmod/bin/slackmod" set-judge-key lead 2>&1)"; SJRC=$?
ST="$(env HOME="$H" PATH="/usr/bin:/bin" "$BASHX" "$H/.slackmod/bin/slackmod" status 2>&1)"
DOC="$(env -i HOME="$H" PATH="/usr/bin:/bin" SLACKMOD_ROOT="$H/.slackmod" SLACKMOD_DOCTOR_FAKE_SLACK=/nonexistent "$BASHX" "$SETUP_DIR/lib/doctor.sh" 2>&1)"
KF14="$H/.slackmod/bots/lead/slack/route-judge.key"
ENVN="$(grep -c -- "$FAKEJ" "$KF14")"
LEAK="$( { printf '%s\n%s\n%s\n%s\n' "$OUT14" "$SJ" "$ST" "$DOC"; cat "$H/.slackmod/config.json" "$H/.slackmod/setup.json" "$H/.slackmod/bots/lead/harness.json" \
          "$H/.slackmod/bots/lead/launch.sh" "$H/.slackmod/bots/lead/mcp.json" "$H/.slackmod/bots/lead/slack/.env" "$H/.slackmod/bots/watch/slack/.env" 2>/dev/null; } | grep -c -- "$FAKEJ")"
[ $SJRC -eq 0 ] && [ "$ENVN" = 1 ] && [ "$LEAK" = 0 ] && [ "$(mode_of "$KF14")" = 600 ] && printf '%s' "$DOC" | grep -q '^요약: ' \
  && ok "⑭b key bait: «slackmod set-judge-key lead» ← fake key → lead slack/route-judge.key 1× (0600) · lead .env · install output · set-judge-key output · status · doctor ($(printf '%s' "$DOC" | grep '^요약: ' | tail -1)) · config · setup · harness · launch · mcp · other bot .env = 0×" \
  || { no "⑭b set-judge-key rc=$SJRC key file $ENVN× leak $LEAK× mode $(mode_of "$KF14")"; printf '%s\n' "$SJ" | tail -2; }
SJ2="$(printf '\n' | env HOME="$H" "$BASHX" "$H/.slackmod/bin/slackmod" set-judge-key lead 2>&1)"; SJ2RC=$?
[ $SJ2RC -ne 0 ] && [ "$(grep -c -- "$FAKEJ" "$KF14")" = 1 ] && printf '%s' "$SJ2" | grep -q 'nothing saved' \
  && ok "⑭c empty input → refused (rc $SJ2RC · «nothing saved») · the key already there kept" || { no "⑭c rc=$SJ2RC"; printf '%s\n' "$SJ2" | tail -2; }
new_home; mk_setup "$T/s14d.json" "d['router'] = {'mode': 'shadow', 'judge': ['python3', '-I', '/opt/judge.py']}"
plan_run "$T/s14d.json"
[ $RC -eq 0 ] && [ "$(jr14 lead)" = "shadow|False|-I /opt/judge.py|None" ] && [ "$(dl14 lead)" = 0 ] \
  && ok "⑭d router shadow + own command → jev_route shadow · that command · harness default timeout · no .env name" || no "⑭d rc=$RC got $(jr14 lead) dotenv $(dl14 lead)"
for ex in "d['router'] = {'mode': 'off', 'judge': 'bundled'}" "d['children'] = False; d['router'] = {'mode': 'on', 'judge': 'bundled'}" "d.pop('router', None)"; do
  new_home; mk_setup "$T/s14e.json" "$ex"
  plan_run "$T/s14e.json"
  [ $RC -eq 0 ] && [ "$(jr14 lead)" = ABSENT ] && [ "$(dl14 lead)" = 0 ] && ok "⑭e $ex → no jev_route · no .env name" || no "⑭e $ex → rc=$RC got $(jr14 lead) dotenv $(dl14 lead)"
done
new_home; mk_setup "$T/s14x.json" "d['router'] = {'mode': 'record', 'judge': 'bundled'}"
before="$(listing "$H")"; plan_run "$T/s14x.json"
[ $RC -eq 2 ] && [ "$(listing "$H")" = "$before" ] && printf '%s' "$OUT" | grep -q 'router.mode' && ok "⑭x router mode «record»: rc 2 · nothing written · names router.mode" || { no "⑭x rc=$RC"; printf '%s\n' "$OUT" | tail -3; }
# ⑮ the gate file pin (10-26 · 공개 전 고정 지문): an edited pass.sh is reported by doctor [13] with the fix line · re-running
# install.sh = the fix: the kit's pass.sh is back (the edit in the backup folder), harness.json pins its sha, doctor [13] OK, then
# «바뀜 0» · a kit update (a new pass.sh in the bundle) re-pins to the new original
pin15() { python3 -I -c 'import hashlib,json,sys; h=json.load(open(sys.argv[1])); o=h["hooks"]["policyOptions"]["pinned-legacy"]
print("%s|%s" % (o["sourceSha256"] == hashlib.sha256(open(o["sourcePath"],"rb").read()).hexdigest(), o.get("repinHint","").startswith("slackmod 키트 폴더(MANIFEST.txt 있는 곳 · 공개 저장소면 그 안 slackmod/)에서 bash install.sh")))' "$H/.slackmod/bots/$1/harness.json" 2>&1; }
doc15() { env -i HOME="$H" PATH="/usr/bin:/bin" SLACKMOD_ROOT="$H/.slackmod" SLACKMOD_DOCTOR_FAKE_SLACK=/nonexistent "$BASHX" "$SETUP_DIR/lib/doctor.sh" 2>&1 | grep -E '^(OK|주의|실패|건너뜀) · \[13\] '; }
new_home; mk_setup "$T/s15.json"; plan_run "$T/s15.json"
P15="$H/.slackmod/hooks/pass.sh"
printf '# 15-EDIT-BAIT\n' >> "$P15"
d1="$(doc15)"
case "$d1" in "주의 · [13] 확인 값이 안 맞음: lead 의 pass.sh; 확인 값이 안 맞음: watch 의 pass.sh"*"다시 맞추기 = slackmod 키트 폴더(MANIFEST.txt 있는 곳 · 공개 저장소면 그 안 slackmod/)에서 bash install.sh"*) ok "⑮a pass.sh edited after install → doctor [13] 주의 · names both bots' pass.sh · the fix line = re-run install.sh" ;;
  *) no "⑮a doctor [13]: $d1" ;; esac
plan_run "$T/s15.json"; R15=$RC
bk="$(grep -rl '15-EDIT-BAIT' "$H/.slackmod" 2>/dev/null | grep -v "^$P15$" | head -1)"
cmp -s "$P15" "$B/hooks/pass.sh" && [ $R15 -eq 0 ] && [ -n "$bk" ] && [ "$(pin15 lead)" = "True|True" ] && case "$(doc15)" in "OK · [13] "*) true ;; *) false ;; esac \
  && ok "⑮b install.sh again = the fix: pass.sh = the kit's original · the edit kept in the backup ($(basename "$(dirname "$bk")")/…) · harness pins its sha · repinHint set · doctor [13] OK" \
  || no "⑮b rc=$R15 cmp=$(cmp -s "$P15" "$B/hooks/pass.sh" && echo same || echo differs) backup=${bk:-none} pin=$(pin15 lead) doctor=$(doc15)"
plan_run "$T/s15.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && ok "⑮c once more → 바뀜 0" || no "⑮c rc=$RC $(count0 "$OUT")"
B15="$T/bundle15"; rm -rf "$B15"; cp -R "$B" "$B15"; printf '# kit update 15\n' >> "$B15/hooks/pass.sh"
OUT="$(env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B15/install.sh" --no-npm --plan "$T/s15.json" 2>&1)"; RC=$?
cmp -s "$P15" "$B15/hooks/pass.sh" && [ $RC -eq 0 ] && [ "$(pin15 lead)" = "True|True" ] && [ "$(pin15 watch)" = "True|True" ] \
  && ok "⑮d kit update (a bundle with a new pass.sh) → installed pass.sh = the new original · both bots pin its sha" || no "⑮d rc=$RC pin=$(pin15 lead)/$(pin15 watch)"
# ⑩ re-plan keeps what setup.json has no column for · backs up the old config
new_home; mk_setup "$T/s10.json"; plan_run "$T/s10.json"
python3 -I - "$H/.slackmod/config.json" <<'PY'
import json, sys
p = sys.argv[1]; c = json.load(open(p))
c['child']['min_disk_free_gb'] = 25; c['aliases']['all'] = 'mybots'; c['slack']['drop_notice'] = False; c['bots'][0]['model'] = 'opus'
json.dump(c, open(p, 'w'), indent=2, ensure_ascii=False)
PY
mk_setup "$T/s10b.json" "d['slack']['channel_id'] = 'CTESTCHAN02'"
plan_run "$T/s10b.json"
nb="$(find "$H/.slackmod/backup" -name config.json 2>/dev/null | wc -l | tr -d ' ')"
[ $RC -eq 0 ] && [ "$(cfg "d['child']['min_disk_free_gb']")" = 25 ] && [ "$(cfg "d['aliases']['all']")" = mybots ] && [ "$(cfg "d['slack']['drop_notice']")" = False ] \
  && [ "$(cfg "d['bots'][0]['model']")" = opus ] && [ "$(cfg "d['slack']['channel_id']")" = CTESTCHAN02 ] && [ "$nb" -ge 1 ] && grep -q '^alias mybots=' "$H/.zshrc" \
  && ok "⑩ re-plan: setup value applied (channel CTESTCHAN02) · kept child 25 · alias mybots · notice off · bot model · old config backed up ($nb)" || { no "⑩ re-plan rc=$RC backups=$nb"; printf '%s\n' "$OUT" | tail -4; }
# ⑪ bot-name length edges
for pair in "a:0" "$(printf 'a%.0s' $(seq 1 32)):0" "$(printf 'a%.0s' $(seq 1 33)):2" "Abc:2" "1abc:2" "a_b:2"; do
  nm="${pair%%:*}"; want="${pair##*:}"
  new_home; mk_setup "$T/s11.json" "d['bots'] = [{'name': '$nm', 'role': 'lead', 'work_dir': '$H/bots/x', 'source': 'blank', 'persona_dir': '$H/bots/x'}]"
  plan_run "$T/s11.json"
  [ $RC -eq "$want" ] && ok "⑪ bot name «${nm:0:12}…» (${#nm} chars) → rc $RC (want $want)" || { no "⑪ bot name ${#nm} chars → rc $RC want $want"; printf '%s\n' "$OUT" | tail -2; }
done
# ⑫ the old path (no --plan): example copied, stops with rc 4
new_home
env SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm > "$T/s12.log" 2>&1; rc=$?
[ $rc -eq 4 ] && [ -f "$H/.slackmod/config.json" ] && ok "⑫ no --plan, no config: example copied · rc 4 (unchanged)" || no "⑫ old path rc=$rc"
finish
