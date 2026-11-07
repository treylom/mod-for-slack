#!/usr/bin/env bash
# m25-bridge-columns.sh — the five hand-written config keys a real running setup needs (M2.5):
#   ① slack.allowed_bot_user_ids → each bot's ALLOWED_SLACK_BOT_USER_IDS (merged after the other bots of this config · no repeats · never itself)
#   ② slack.channel_ids          → SLACK_CHANNEL_ID in the bridge's own «C…,C…,*» form (first = primary · «*» once, never first)
#   ③ bots[].extra_channels      → words after «--dangerously-load-development-channels server:slack-channel» in the bot window line
#   ③ bots[].extra_env           → env names exported into the bot window (secret-shaped / reserved / secret-named = refused, never echoed)
#   ④ slackmod check-windows     → also finds the standalone shape «node … dist/server.js» whose folder is a channel-server one
#   ⑤ the overlap message names the OS it ran on (이 맥 / 이 리눅스 / 이 컴퓨터)
# Every key: one positive and several negative cases; a config WITHOUT the keys makes exactly the bytes it made before (golden).
#   bash setup/tests/m25-bridge-columns.sh        Throwaway HOMEs and fake ps/lsof/uname/claude only. rc 0 = all PASS.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/plan-lib.sh"
T="$(mk_tmp m25-cols)"
trap 'rm -rf "$T"' EXIT
GOLDEN="$SETUP_TESTS_DIR/golden/plan-base.json"

# ---- part 1: the config library itself (problems() and plan()) ------------------------------------------------
env HOME=/h python3 -I - "$PORT_DIR/lib/slackmod_config.py" "$GOLDEN" <<'PY'
import copy, importlib.util, json, sys
sys.dont_write_bytecode = True
lib, golden = sys.argv[1:3]
spec = importlib.util.spec_from_file_location('cfgmod', lib)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fail = 0
def ok(t): print('PASS ' + t)
def no(t):
    global fail
    print('FAIL ' + t); fail = 1
BASE = {'schema': 1,
        'slack': {'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'drop_notice': True, 'drop_notice_no_mention': True},
        'bots': [{'name': 'lead', 'work_dir': '/w/lead', 'slack_bot_user_id': 'UTESTBOT001', 'model': ''},
                 {'name': 'watch', 'work_dir': '/w/watch', 'slack_bot_user_id': 'UTESTBOT002', 'model': 'opus'}],
        'aliases': {'all': 'allbots', 'all_stop': 'allbots-stop'}, 'permission': 'skip',
        'child': {'model': 'sonnet', 'effort': 'medium', 'min_disk_free_gb': 20, 'min_free_mem_pct': 15}}
def make(mut=None):
    c = copy.deepcopy(BASE)
    if mut: mut(c)
    return c
def plan_of(c): return m.plan(c, '/r', '/py', '/node', '/claude', '/bin/sh', '0' * 64)
def env_of(mut, bot):
    return plan_of(make(mut))['env'][bot]
def launch_of(mut, bot):
    for f in plan_of(make(mut))['files']:
        if f['path'].endswith('/bots/%s/launch.sh' % bot): return f['content']
    return None
def home_channel(mut, bot):
    for f in plan_of(make(mut))['files']:
        if f['path'].endswith('/bots/%s/harness.json' % bot): return json.loads(f['content'])['slack']['home_channel']

# golden: an old config (none of the new keys) plans to the same bytes as before M2.5
want = open(golden, encoding='utf-8').read()
got = json.dumps(plan_of(make()), indent=2, ensure_ascii=False, sort_keys=True) + '\n'
(ok if got == want else no)('G0 old config (no new key) → plan() is byte-for-byte the golden made before M2.5 (%d bytes)' % len(want))
(ok if 'SM_EXTRA' not in got else no)('G0b old config → no SM_EXTRA line in any launch file')

def good(label, mut, secrets=()):
    p = m.problems(make(mut))
    (ok if p == [] else no)('%s → passes (got %s)' % (label, p))
def bad(label, mut, where, secrets=()):
    p = m.problems(make(mut))
    hit = [x for x in p if where in x]
    leak = [s for s in secrets if s in '\n'.join(p)]
    (ok if len(hit) >= 1 and len(p) == len(hit) and not leak else no)('%s → refused at «%s»%s (got %s)' % (label, where, ' · value not echoed' if secrets else '', p))
def slack(k, v):
    def f(c):
        if v is None: c['slack'].pop(k, None)
        else: c['slack'][k] = v
    return f
def bot0(k, v):
    def f(c): c['bots'][0][k] = v
    return f

# ① slack.allowed_bot_user_ids
EXT1, EXT2 = 'UEXTBOT0001', 'UEXTBOT0002'
good('①a allowed_bot_user_ids absent', slack('allowed_bot_user_ids', None))
good('①b allowed_bot_user_ids empty list', slack('allowed_bot_user_ids', []))
good('①c allowed_bot_user_ids two ids', slack('allowed_bot_user_ids', [EXT1, EXT2]))
bad('①d not a list', slack('allowed_bot_user_ids', EXT1), 'slack.allowed_bot_user_ids')
bad('①e wrong shape «U1»', slack('allowed_bot_user_ids', ['U1']), 'slack.allowed_bot_user_ids')
bad('①f channel-shaped id', slack('allowed_bot_user_ids', ['CEXTBOT0001']), 'slack.allowed_bot_user_ids')
bad('①g placeholder', slack('allowed_bot_user_ids', ['UREPLACE-ME']), 'slack.allowed_bot_user_ids')
bad('①h repeated id', slack('allowed_bot_user_ids', [EXT1, EXT1]), 'slack.allowed_bot_user_ids')
bad('①i non-string entry', slack('allowed_bot_user_ids', [5]), 'slack.allowed_bot_user_ids')
bad('①j the owner (a person) listed as a bot', slack('allowed_bot_user_ids', ['UTESTUSER01']), 'slack.allowed_bot_user_ids')
bad('①k 51 entries', slack('allowed_bot_user_ids', ['U%010d' % i for i in range(51)]), 'slack.allowed_bot_user_ids')
e = env_of(slack('allowed_bot_user_ids', [EXT1, EXT2]), 'lead')['ALLOWED_SLACK_BOT_USER_IDS']
(ok if e == 'UTESTBOT002,%s,%s' % (EXT1, EXT2) else no)('①l lead: the other bot of the config first, then the listed outsiders (got %s)' % e)
e = env_of(slack('allowed_bot_user_ids', [EXT1, EXT2]), 'watch')['ALLOWED_SLACK_BOT_USER_IDS']
(ok if e == 'UTESTBOT001,%s,%s' % (EXT1, EXT2) else no)('①m watch: same rule from its side (got %s)' % e)
e1 = env_of(slack('allowed_bot_user_ids', ['UTESTBOT001', 'UTESTBOT002']), 'lead')['ALLOWED_SLACK_BOT_USER_IDS']
e2 = env_of(slack('allowed_bot_user_ids', ['UTESTBOT001', 'UTESTBOT002']), 'watch')['ALLOWED_SLACK_BOT_USER_IDS']
(ok if (e1, e2) == ('UTESTBOT002', 'UTESTBOT001') else no)('①n an id already known (a peer) or the bot itself is not repeated/added (got %r %r)' % (e1, e2))
def noid(c): c['bots'][0]['slack_bot_user_id'] = ''; c['slack']['allowed_bot_user_ids'] = [EXT1]
e = env_of(noid, 'lead')['ALLOWED_SLACK_BOT_USER_IDS']
(ok if e == 'UTESTBOT002,%s' % EXT1 else no)('①o a bot without its own id still gets peers + outsiders (got %s)' % e)

# ② slack.channel_ids
good('②a channel_ids absent', slack('channel_ids', None))
good('②b channel_ids empty list', slack('channel_ids', []))
good('②c channel_ids one more channel', slack('channel_ids', ['CEXTRA00001']))
good('②d channel_ids one more + «*»', slack('channel_ids', ['CEXTRA00001', '*']))
good('②e a private channel (G…) as well', slack('channel_ids', ['GEXTRA00001']))
bad('②f «*» first and no channel_id', lambda c: (c['slack'].__setitem__('channel_id', ''), c['slack'].__setitem__('channel_ids', ['*', 'CEXTRA00001'])), 'slack.channel_id')
bad('②g «*» twice', slack('channel_ids', ['CEXTRA00001', '*', '*']), 'slack.channel_ids')
bad('②h wrong shape', slack('channel_ids', ['channel-one']), 'slack.channel_ids')
bad('②i user-shaped id', slack('channel_ids', ['UEXTRA00001']), 'slack.channel_ids')
bad('②j repeated', slack('channel_ids', ['CEXTRA00001', 'CEXTRA00001']), 'slack.channel_ids')
bad('②k not a list', slack('channel_ids', 'CEXTRA00001'), 'slack.channel_ids')
bad('②l non-string entry', slack('channel_ids', [7]), 'slack.channel_ids')
bad('②m 51 entries', slack('channel_ids', ['C%010d' % i for i in range(51)]), 'slack.channel_ids')
bad('②n placeholder', slack('channel_ids', ['CREPLACE-ME']), 'slack.channel_ids')
good('②o channel_id empty but channel_ids has a real first channel (it becomes the primary)', lambda c: (c['slack'].__setitem__('channel_id', ''), c['slack'].__setitem__('channel_ids', ['CEXTRA00001', '*'])))
e = env_of(slack('channel_ids', ['CEXTRA00001', '*']), 'lead')['SLACK_CHANNEL_ID']
(ok if e == 'CTESTCHAN01,CEXTRA00001,*' else no)('②p env: primary first, then the list, «*» last — the bridge form (got %s)' % e)
e = env_of(slack('channel_ids', ['CTESTCHAN01', 'CEXTRA00001']), 'lead')['SLACK_CHANNEL_ID']
(ok if e == 'CTESTCHAN01,CEXTRA00001' else no)('②q the primary named again in the list is not repeated (got %s)' % e)
h = home_channel(slack('channel_ids', ['CEXTRA00001', '*']), 'lead')
(ok if h == 'CTESTCHAN01' else no)('②r harness.json slack.home_channel stays the primary channel only (got %s)' % h)
def only_list(c): c['slack']['channel_id'] = ''; c['slack']['channel_ids'] = ['CEXTRA00001', '*']
e, h = env_of(only_list, 'lead')['SLACK_CHANNEL_ID'], home_channel(only_list, 'lead')
(ok if (e, h) == ('CEXTRA00001,*', 'CEXTRA00001') else no)('②s no channel_id: the list\'s first entry is the primary (env %s · home %s)' % (e, h))

# ③ bots[].extra_channels
good('③a extra_channels absent', bot0('extra_channels', None))
good('③b extra_channels empty', bot0('extra_channels', []))
good('③c server: and plugin: forms', bot0('extra_channels', ['server:docs-feed', 'plugin:telegram@official-plugins']))
bad('③d not a list', bot0('extra_channels', 'server:docs'), 'bots[0].extra_channels')
bad('③e a space inside one word', bot0('extra_channels', ['server:docs feed']), 'bots[0].extra_channels')
bad('③f shell characters', bot0('extra_channels', ['server:docs;rm']), 'bots[0].extra_channels')
bad('③g command substitution', bot0('extra_channels', ['server:$(id)']), 'bots[0].extra_channels')
bad('③h no server:/plugin: prefix', bot0('extra_channels', ['docs']), 'bots[0].extra_channels')
bad('③i the Slack bridge again', bot0('extra_channels', ['server:slack-channel']), 'bots[0].extra_channels')
bad('③j repeated', bot0('extra_channels', ['server:docs', 'server:docs']), 'bots[0].extra_channels')
bad('③k nine entries', bot0('extra_channels', ['server:c%d' % i for i in range(9)]), 'bots[0].extra_channels')
bad('③l non-string entry', bot0('extra_channels', [1]), 'bots[0].extra_channels')
bad('③m a leading dash (looks like an option)', bot0('extra_channels', ['--x']), 'bots[0].extra_channels')
l = launch_of(bot0('extra_channels', ['server:docs-feed', 'plugin:tg@src']), 'lead')
(ok if "SM_EXTRA_CHANNELS='server:docs-feed plugin:tg@src'" in l or 'SM_EXTRA_CHANNELS=server:docs-feed' in l else no)('③n launch file: SM_EXTRA_CHANNELS line for the bot that asked')
l2 = launch_of(bot0('extra_channels', ['server:docs-feed']), 'watch')
(ok if 'SM_EXTRA' not in l2 else no)('③o the other bot (no key) has no SM_EXTRA line')

# ③ bots[].extra_env
good('③p extra_env absent', bot0('extra_env', None))
good('③q extra_env empty', bot0('extra_env', {}))
good('③r extra_env two plain values', bot0('extra_env', {'TZ': 'Asia/Seoul', 'NO_COLOR': 'a b "c" $HOME'}))
for nm in ('PATH', 'HOME', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'MODS_HARNESS_BOT', 'SM_CLAUDE', 'SLACK_BOT_TOKEN', 'ALLOWED_SLACK_USER_ID', 'ANTHROPIC_API_KEY', 'CLAUDE_CHANNEL_SLACK_DIR', 'DISABLE_AUTOUPDATER'):
    bad('③s reserved name %s' % nm, bot0('extra_env', {nm: 'x'}), 'bots[0].extra_env.%s' % nm)
for nm in ('MY_TOKEN', 'APP_SECRET', 'DB_PASSWORD', 'SERVICE_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_PAT', 'DB_PASSWD'):   # (round 2: allowed endings)
    # sec ④ (10-25): a secret-looking name is accepted, but its value is never written into launch.sh — only the name is listed there
    # (the value goes to the bot's own .env, 0600). Before: refused.
    good('③t secret-named variable %s accepted (value goes to the bot\'s own .env)' % nm, bot0('extra_env', {nm: 'val-' + nm}))
    l = launch_of(bot0('extra_env', {nm: 'val-' + nm}), 'lead')
    (ok if ('val-' + nm) not in l and ('SM_EXTRA_ENV_DOTENV=(%s)' % nm) in l.split('\n') else no)('③t2 %s: value not in launch.sh · name listed for the .env route' % nm)
for nm in ('lower', '1ABC', 'A-B', 'A B', ''):
    bad('③u not a variable name «%s»' % nm, bot0('extra_env', {nm: 'x'}), 'bots[0].extra_env')
XOX = 'xo' + 'xb-' + '1' * 10 + '-' + 'q' * 8   # (assembled: this file carries no credential-shaped text)
SECRETS = [XOX, 'xa' + 'pp-1-' + 'A1B2C3D4E5', 'sk' + '-' + 'q' * 16, 'gh' + 'p_' + 'Z' * 16, 'AK' + 'IA' + 'Q' * 8, 'AI' + 'za' + 'Sy' + 'q' * 12]
for s in SECRETS:
    bad('③v secret-shaped value «%s…»' % s[:5], bot0('extra_env', {'NO_COLOR': s}), 'bots[0].extra_env.NO_COLOR', secrets=(s,))
bad('③w secret-shaped value in the middle of text', bot0('extra_env', {'NO_COLOR': 'use ' + XOX + ' now'}), 'bots[0].extra_env.NO_COLOR', secrets=(XOX,))
bad('③x a newline in the value', bot0('extra_env', {'NO_COLOR': 'a\nb'}), 'bots[0].extra_env.NO_COLOR')
bad('③y a NUL in the value', bot0('extra_env', {'NO_COLOR': 'a\0b'}), 'bots[0].extra_env.NO_COLOR')
bad('③z 501 characters', bot0('extra_env', {'NO_COLOR': 'a' * 501}), 'bots[0].extra_env.NO_COLOR')
good('③A 500 characters', bot0('extra_env', {'NO_COLOR': 'a' * 500}))
bad('③B a number value', bot0('extra_env', {'NO_COLOR': 5}), 'bots[0].extra_env.NO_COLOR')
bad('③C placeholder value', bot0('extra_env', {'NO_COLOR': 'REPLACE-ME'}), 'bots[0].extra_env.NO_COLOR')
bad('③D not an object', bot0('extra_env', ['A=b']), 'bots[0].extra_env')
bad('③E 21 variables', bot0('extra_env', {'V%02d_TOKEN' % i: 'x' for i in range(21)}), 'bots[0].extra_env')
good('③F 20 variables', bot0('extra_env', {'V%02d_TOKEN' % i: 'x' for i in range(20)}))
l = launch_of(bot0('extra_env', {'TZ': 'UTC', 'NO_COLOR': 'a b "c" $HOME `x`'}), 'lead')
line = [x for x in l.split('\n') if x.startswith('SM_EXTRA_ENV=')]
(ok if len(line) == 1 and line[0].startswith('SM_EXTRA_ENV=(') and line[0].index('NO_COLOR') < line[0].index('TZ') else no)('③G launch file: one SM_EXTRA_ENV=( … ) array line, names sorted (got %s)' % line)

# setup → config: the keys written by hand are carried through a re-plan (setup.json has no column for them)
base = make(lambda c: (c['slack'].update({'allowed_bot_user_ids': [EXT1], 'channel_ids': ['CEXTRA00001', '*']}),
                       c['bots'][0].update({'extra_channels': ['server:docs-feed'], 'extra_env': {'TZ': 'UTC'}})))
st = {'schema': 1, 'mode': 'full', 'slack': {'enabled': True, 'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'guests': []},
      'bots': [{'name': 'lead', 'work_dir': '/w/lead'}, {'name': 'watch', 'work_dir': '/w/watch'}]}
cfg, probs = m.setup_to_config(st, base, '/h')
c0 = cfg['bots'][0]
(ok if probs == [] and cfg['slack'].get('allowed_bot_user_ids') == [EXT1] and cfg['slack'].get('channel_ids') == ['CEXTRA00001', '*']
   and c0.get('extra_channels') == ['server:docs-feed'] and c0.get('extra_env') == {'TZ': 'UTC'} and 'extra_env' not in cfg['bots'][1] else no)('⑥a setup → config keeps the hand-written keys of the base config (got problems %s)' % probs)
cfg2, _ = m.setup_to_config(st, make(), '/h')
(ok if 'allowed_bot_user_ids' not in cfg2['slack'] and 'channel_ids' not in cfg2['slack'] and 'extra_env' not in cfg2['bots'][0] and 'extra_channels' not in cfg2['bots'][0] else no)('⑥b a base config without the keys adds none')
sys.exit(fail)
PY
rc=$?; [ $rc -eq 0 ] || FAIL=1

# ---- part 2: install.sh --plan / install.sh → files → slackmod _print-main / _run-main with a fake claude -------------
B="$T/bundle"; make_bundle "$B"
FB="$T/fakebin"; mkdir -p "$FB"
cat > "$FB/claude" <<'FAKE'
#!/bin/sh
# fake claude: writes what it was started with to $FAKE_OUT (arguments one per line + two env names)
{ for a in "$@"; do printf 'ARG[%s]\n' "$a"; done; printf 'TZ=%s\n' "${TZ-unset}"; printf 'NO_COLOR=%s\n' "${NO_COLOR-unset}"; printf 'HOME_SEEN=%s\n' "$HOME"; } > "$FAKE_OUT"
FAKE
chmod 755 "$FB/claude"
TRUEBIN=/usr/bin/true; [ -x "$TRUEBIN" ] || TRUEBIN=/bin/true
inject() { # inject <python statements on c (the config dict)>
  python3 -I - "$H/.slackmod/config.json" "$1" <<'PY'
import json, sys
p, code = sys.argv[1:3]
c = json.load(open(p)); exec(code)
json.dump(c, open(p, 'w'), indent=2, ensure_ascii=False)
PY
}
plan_fake() { # like plan_run, with the fake claude first on PATH (so the launch files point at it)
  local f="$1"; shift
  OUT="$(env PATH="$FB:$PATH" SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm --plan "$f" "$@" 2>&1)"; RC=$?
}
sm() { env PATH="$FB:$PATH" SLACKMOD_ROOT="$H/.slackmod" HOME="$H" "$BASHX" "$H/.slackmod/bin/slackmod" "$@"; }

new_home
mk_setup "$T/s1.json" "d['bots'][0]['slack_bot_user_id'] = 'UTESTBOT001'; d['bots'][1]['slack_bot_user_id'] = 'UTESTBOT002'"
plan_fake "$T/s1.json"
L="$H/.slackmod/bots/lead/launch.sh"; W="$H/.slackmod/bots/watch/launch.sh"
E="$H/.slackmod/bots/lead/slack/.env"
if [ $RC -eq 0 ] && ! grep -q 'SM_EXTRA' "$L" "$W" && grep -q '^SLACK_CHANNEL_ID=CTESTCHAN01$' "$E" && grep -q '^ALLOWED_SLACK_BOT_USER_IDS=UTESTBOT002$' "$E"; then
  ok "⑦a old shape installed: no SM_EXTRA line · SLACK_CHANNEL_ID one channel · bot ids = the other bot only"
else no "⑦a old shape rc=$RC"; printf '%s\n' "$OUT" | tail -4; fi
sm _print-main lead > "$T/print-old.txt" 2>&1; sm _print-main watch > "$T/print-old-watch.txt" 2>&1
n1="$(grep -c -e 'server:slack-channel --append-system-prompt-file' "$T/print-old.txt" || true)"
[ "$n1" = 1 ] && ok "⑦b old shape: «server:slack-channel» is followed directly by --append-system-prompt-file (as before)" || { no "⑦b old print n=$n1"; cat "$T/print-old.txt"; }

# the hand-written keys, then a re-plan (the keys must survive it) and apply
inject "c['slack']['allowed_bot_user_ids'] = ['UEXTBOT0001']; c['slack']['channel_ids'] = ['CEXTRA00001', '*']; c['bots'][0]['extra_channels'] = ['server:docs-feed', 'plugin:tg@src']; c['bots'][0]['extra_env'] = {'TZ': 'UTC', 'NO_COLOR': 'a b \"c\" \$HOME'}"
plan_fake "$T/s1.json"
if [ $RC -eq 0 ] && grep -q '^SLACK_CHANNEL_ID=CTESTCHAN01,CEXTRA00001,\*$' "$E" && grep -q '^ALLOWED_SLACK_BOT_USER_IDS=UTESTBOT002,UEXTBOT0001$' "$E" \
   && grep -q '^ALLOWED_SLACK_BOT_USER_IDS=UTESTBOT001,UEXTBOT0001$' "$H/.slackmod/bots/watch/slack/.env" \
   && grep -q '^SLACK_CHANNEL_ID=CTESTCHAN01,CEXTRA00001,\*$' "$H/.slackmod/bots/watch/slack/.env"; then
  ok "⑧a re-plan: both bots' .env get the channel list «C…,C…,*» and the merged bot ids (hand-written keys survived the re-plan)"
else no "⑧a rc=$RC"; printf '%s\n' "$OUT" | tail -4; grep -h 'SLACK_CHANNEL_ID\|ALLOWED_SLACK_BOT' "$E"; fi
[ "$(hjs lead "d['slack']['home_channel']")" = CTESTCHAN01 ] && ok "⑧b harness.json home_channel = the primary channel only" || no "⑧b home_channel $(hjs lead "d['slack']")"
grep -q '^SM_EXTRA_CHANNELS=' "$L" && grep -q '^SM_EXTRA_ENV=(' "$L" && ! grep -q 'SM_EXTRA' "$W" && ok "⑧c launch.sh: extras only in the bot that asked (lead yes · watch none)" || no "⑧c launch files"
sm _print-main lead > "$T/print-new.txt" 2>&1
if grep -q -e 'server:slack-channel server:docs-feed plugin:tg@src --append-system-prompt-file' "$T/print-new.txt" || grep -q -e 'server:slack-channel server:docs-feed plugin:tg\\@src --append-system-prompt-file' "$T/print-new.txt"; then
  ok "⑧d _print-main lead: extra channels come right after server:slack-channel, before --append-system-prompt-file"
else no "⑧d print"; cat "$T/print-new.txt"; fi
grep -q '^# extra env, names only.* NO_COLOR TZ$' "$T/print-new.txt" && ! grep -q -e 'TZ=' -e 'NO_COLOR=' "$T/print-new.txt" && ok "⑧e _print-main lead: extra env as NAMES only (sec ④: no value on a screen)" || { no "⑧e env words"; head -4 "$T/print-new.txt"; }
sm _print-main watch > "$T/print-new-watch.txt" 2>&1
cmp -s "$T/print-new-watch.txt" "$T/print-old-watch.txt" && ok "⑧f _print-main watch (no extras) = the same bytes as before the keys existed" || no "⑧f watch print differs"
# really start it (fake claude) and see the arguments + the environment arrive
mkdir -p "$H/bots/lead"
env FAKE_OUT="$T/fake-out.txt" SHELL="$TRUEBIN" PATH="$FB:$PATH" SLACKMOD_ROOT="$H/.slackmod" HOME="$H" "$BASHX" "$H/.slackmod/bin/slackmod" _run-main lead > "$T/run-main.txt" 2>&1; rrc=$?
if [ -f "$T/fake-out.txt" ] && grep -qxF 'TZ=UTC' "$T/fake-out.txt" && grep -qxF 'NO_COLOR=a b "c" $HOME' "$T/fake-out.txt" \
   && grep -qxF 'ARG[server:docs-feed]' "$T/fake-out.txt" && grep -qxF 'ARG[plugin:tg@src]' "$T/fake-out.txt" && grep -qxF 'ARG[--dangerously-load-development-channels]' "$T/fake-out.txt"; then
  ok "⑧g _run-main (fake claude): the extra words arrive as arguments and TZ / NO_COLOR arrive as env (value kept literally, no expansion)"
else no "⑧g run-main rc=$rrc"; cat "$T/fake-out.txt" 2>/dev/null; tail -3 "$T/run-main.txt"; fi
a="$(grep -n 'ARG\[' "$T/fake-out.txt" | sed -n 's/^\([0-9]*\):ARG\[\(.*\)\]$/\2/p' | tr '\n' ' ')"
case "$a" in *"server:slack-channel server:docs-feed plugin:tg@src --append-system-prompt-file "*) ok "⑧h _run-main: argument order is …server:slack-channel · server:docs-feed · plugin:tg@src · --append-system-prompt-file" ;; *) no "⑧h order: $a" ;; esac
# idempotent: the same plan again, and the plain install (no --plan) on the written config
before="$(listing "$H" | grep -v 'state/install.fp')"; plan_fake "$T/s1.json"
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] && ok "⑧i same plan again: 바뀜 0 · files unchanged" || { no "⑧i again rc=$RC $(count0 "$OUT")"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -4; }
OUT="$(env PATH="$FB:$PATH" SHELL=/bin/zsh HOME="$H" "$BASHX" "$B/install.sh" --no-npm 2>&1)"; RC=$?
[ $RC -eq 0 ] && [ "$(count0 "$OUT")" = "바뀜 0" ] && ok "⑧j plain install.sh on the same config (no --plan): 바뀜 0" || { no "⑧j plain rc=$RC $(count0 "$OUT")"; printf '%s\n' "$OUT" | grep -v 그대로 | tail -4; }

# refusals through the real installer: rc 2 · nothing written · the secret never printed
XOXB="xo""xb-1111111111-qqqqqqqq"   # (assembled: this file carries no credential-shaped text)
refuse() { # refuse <label> <python on c> <must-name> [secret-that-must-not-appear]
  new_home; mk_setup "$T/r.json" "d['bots'][0]['slack_bot_user_id'] = 'UTESTBOT001'"
  plan_fake "$T/r.json"; [ $RC -eq 0 ] || { no "$1 (setup run rc=$RC)"; return; }
  inject "$2"
  local before; before="$(listing "$H" | grep -v 'state/install.fp')"
  plan_fake "$T/r.json"
  local leak=0; [ -n "${4:-}" ] && printf '%s' "$OUT" | grep -q -F -- "$4" && leak=1
  if [ $RC -eq 2 ] && printf '%s' "$OUT" | grep -q -F -- "$3" && [ "$(listing "$H" | grep -v 'state/install.fp')" = "$before" ] && [ $leak = 0 ]; then
    ok "$1 → rc 2 · names $3 · nothing written${4:+ · value not printed}"
  else no "$1 rc=$RC leak=$leak"; printf '%s\n' "$OUT" | tail -4; fi
}
refuse "⑨a extra_env PATH"             "c['bots'][0]['extra_env'] = {'PATH': '/tmp'}"                              "extra_env.PATH"
refuse "⑨b extra_env secret-shaped"    "c['bots'][0]['extra_env'] = {'NO_COLOR': '$XOXB'}"     "extra_env.NO_COLOR" "$XOXB"
refuse "⑨c extra_env shell hook name"  "c['bots'][0]['extra_env'] = {'PROMPT_COMMAND': 'echo hunter2'}"              "extra_env.PROMPT_COMMAND" "hunter2"
refuse "⑨d extra_channels with a space" "c['bots'][0]['extra_channels'] = ['server:a b']"                          "extra_channels"
refuse "⑨e channel_ids «*» twice"      "c['slack']['channel_ids'] = ['CEXTRA00001', '*', '*']"                     "slack.channel_ids"
refuse "⑨f allowed_bot_user_ids bad"   "c['slack']['allowed_bot_user_ids'] = ['bot-one']"                          "allowed_bot_user_ids"

# ---- part 3: check-windows with fake ps / lsof / uname -----------------------------------------------------------
new_home; sm_root="$H/.slackmod"
mkdir -p "$sm_root/bin" "$sm_root/lib"; cp "$PORT_DIR/bin/slackmod" "$sm_root/bin/"; cp "$PORT_DIR/lib/slackmod_config.py" "$sm_root/lib/"
XB="$T/xbin"; mkdir -p "$XB"
cat > "$XB/ps" <<'FAKE'
#!/bin/sh
cat "$FAKE_PS"
FAKE
cat > "$XB/lsof" <<'FAKE'
#!/bin/sh
# lsof -a -p PID -d cwd -Fn → «p<pid>» «n<folder>» from $FAKE_CWD («pid folder» lines)
pid=""; while [ $# -gt 0 ]; do [ "$1" = -p ] && pid="$2"; shift; done
dir="$(awk -v p="$pid" '$1 == p { $1 = ""; sub(/^ /, ""); print; exit }' "$FAKE_CWD")"
[ -n "$dir" ] && printf 'p%s\nn%s\n' "$pid" "$dir"
exit 0
FAKE
cat > "$XB/uname" <<'FAKE'
#!/bin/sh
echo "${FAKE_UNAME:-Linux}"
FAKE
chmod 755 "$XB/ps" "$XB/lsof" "$XB/uname"
cw() { # cw <label> <uname> <expected count word> — uses $T/ps.txt and $T/cwd.txt
  env PATH="$XB:$PATH" SLACKMOD_ROOT="$sm_root" HOME="$H" FAKE_PS="$T/ps.txt" FAKE_CWD="$T/cwd.txt" FAKE_UNAME="$2" "$BASHX" "$sm_root/bin/slackmod" check-windows 2>&1
}
cat > "$T/cwd.txt" <<EOF
99990002 /srv/claude-channel-server
99990003 /srv/other-app
99990006 /srv/channel-server-old
EOF
# shape ①: a command line naming the bridge · shape ②: «node … dist/server.js» whose folder is a channel-server folder
cat > "$T/ps.txt" <<EOF
99990001 node /opt/x/channel-server/dist/server.js
99990002 /usr/bin/node dist/server.js
99990003 node dist/server.js
99990004 node $sm_root/app/channel-server/dist/server.js
99990005 grep channel-server
99990006 node /usr/bin/node dist/server.js
99990007 python3 -m http.server
EOF
out="$(cw a Linux)"; rc=$?
if [ $rc -eq 1 ] && printf '%s' "$out" | grep -q '이 리눅스 안에 mod-for-slack 밖에서 켠 Slack 다리 3개'; then
  ok "⑩a check-windows: counts 3 (named bridge + two standalone «node dist/server.js» in channel-server folders) · skips other-app, ours (\$ROOT/app/), grep, python → rc 1"
else no "⑩a rc=$rc"; printf '%s\n' "$out" | head -3; fi
out="$(cw b Darwin)"; rc=$?
printf '%s' "$out" | grep -q '이 맥 안에 mod-for-slack 밖에서 켠 Slack 다리 3개' && [ $rc -eq 1 ] && ok "⑩b uname Darwin → «이 맥» wording (rc 1)" || { no "⑩b rc=$rc"; printf '%s\n' "$out" | head -2; }
out="$(cw c FreeBSD)"; rc=$?
printf '%s' "$out" | grep -q '이 컴퓨터 안에 mod-for-slack 밖에서 켠 Slack 다리 3개' && [ $rc -eq 1 ] && ok "⑩c other OS → «이 컴퓨터» wording (rc 1)" || { no "⑩c rc=$rc"; printf '%s\n' "$out" | head -2; }
out="$(cw a Linux)"; printf '%s' "$out" | grep -q 'systemd' && ok "⑩d the message names the old shapes (예전 방식 · systemd)" || no "⑩d message"
# negatives: nothing that is a bridge → not rc 1, no «다리 N개» line
cat > "$T/ps.txt" <<EOF
99990003 node dist/server.js
99990004 node $sm_root/app/channel-server/dist/server.js
99990005 grep channel-server
99990007 python3 -m http.server
EOF
out="$(cw n Linux)"; rc=$?
if [ $rc -ne 1 ] && ! printf '%s' "$out" | grep -q '다리 [0-9]*개'; then ok "⑩e only look-alikes (other-app node · our own app · grep · python) → not counted (rc $rc · no overlap line)"; else no "⑩e rc=$rc"; printf '%s\n' "$out" | head -3; fi
# a standalone node with an unknown folder (lsof knows nothing) is not counted
: > "$T/cwd.txt"; printf '99990009 node dist/server.js\n' > "$T/ps.txt"
out="$(cw n2 Linux)"; rc=$?
[ $rc -ne 1 ] && ok "⑩f standalone «node dist/server.js» with an unknown folder → not counted (no guessing)" || { no "⑩f rc=$rc"; printf '%s\n' "$out" | head -2; }
# the old command-line shape alone (the shape that was found before) still counts exactly once
printf '99990010 /usr/bin/node /opt/claude-channel-server/dist/index.js\n' > "$T/ps.txt"
out="$(cw n3 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ok "⑩g «claude-channel-server» in the command line → counted once (as before)" || { no "⑩g rc=$rc"; printf '%s\n' "$out" | head -2; }
# K21 (10-25 · measured on a WSL test machine): an old bot window's relay «…/claude-channel-server/dist/mcp.js» holds no Slack connection
# (bridge mcp.ts:2-4 «no Slack credentials and no Socket Mode connection of its own») — not a bridge: not counted, not rc 1
# (start is not blocked), but said on one line (that window gets no Slack while ours runs)
printf '99990011 node /home/u/.claude/plugins/claude-channel-server/dist/mcp.js\n' > "$T/ps.txt"
out="$(cw r1 Linux)"; rc=$?
if [ $rc -ne 1 ] && ! printf '%s' "$out" | grep -q '다리 [0-9]*개' && printf '%s' "$out" | grep -q '중계 부품(mcp.js) 1개'; then ok "⑩h relay mcp.js alone → not a bridge (rc $rc) · said as «중계 부품(mcp.js) 1개»"; else no "⑩h rc=$rc"; printf '%s\n' "$out" | head -3; fi
# relay + a real bridge → the bridge is still counted once (rc 1) and the relay is not added to it
printf '99990011 node /home/u/.claude/plugins/claude-channel-server/dist/mcp.js\n99990001 node /opt/x/channel-server/dist/server.js\n' > "$T/ps.txt"
out="$(cw r2 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ok "⑩i relay + one real bridge → «다리 1개» (relay not added) · rc 1" || { no "⑩i rc=$rc"; printf '%s\n' "$out" | head -3; }
# a bridge whose command line also carries «dist/mcp.js» (an argument) is still a bridge — the relay word cannot hide it
printf '99990012 node /opt/claude-channel-server/dist/server.js --note dist/mcp.js\n' > "$T/ps.txt"
out="$(cw r3 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩j server.js + an «dist/mcp.js» argument → a bridge (1) · not a relay" || { no "⑩j rc=$rc"; printf '%s\n' "$out" | head -3; }
# sec ⑪ (independent review 10-25): «…/dist/mcp.js» in the command line is not a password — the real server code started under
# that file name must still stop the start. Claude starts the relay from mcp.json with NO arguments (ThisCode src/mcp.ts reads no
# argv · slackmod starts the server with none either), so a relay = «dist/mcp.js» with nothing after it; anything after it = a bridge.
# (Residual, not closable by command-line reading: a same-account process can start the server code with no arguments too.)
printf '99990013 node /outside/claude-channel-server/dist/mcp.js --socket-mode\n' > "$T/ps.txt"
out="$(cw k1 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩k sec ⑪: «…/claude-channel-server/dist/mcp.js --socket-mode» → a bridge (start blocked · rc 1) · not a relay" || { no "⑩k rc=$rc (relay label instead of bridge?)"; printf '%s\n' "$out" | head -3; }
printf '99990014 node /outside/channel-server/dist/mcp.js --x\n' > "$T/ps.txt"
out="$(cw k2 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩l sec ⑪: «…/channel-server/dist/mcp.js --x» (no «claude-» in the path) → a bridge too" || { no "⑩l rc=$rc"; printf '%s\n' "$out" | head -3; }
printf '99990015 /srv/claude-channel-server\n' > "$T/cwd.txt"
printf '99990015 node dist/mcp.js --socket-mode\n' > "$T/ps.txt"
out="$(cw k3 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩m sec ⑪: relative «node dist/mcp.js --socket-mode» in a channel-server folder → a bridge" || { no "⑩m rc=$rc"; printf '%s\n' "$out" | head -3; }
# sec ⑪ round 2 (re-review 10-26): ① the line END is not the rule — the script word (first «dist/…js») must be the LAST word;
# ② «grep» anywhere on a line no longer skips it (only a process that IS grep) · ③ our install path somewhere on the line no
# longer makes it ours (every word naming the bridge package must sit under $ROOT/app/ — doctor [7] same rule)
printf '99990017 node /outside/claude-channel-server/dist/mcp.js --socket-mode dist/mcp.js\n' > "$T/ps.txt"
out="$(cw k6 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩p sec ⑪ r2: «…/dist/mcp.js --socket-mode dist/mcp.js» (ends in mcp.js again) → a bridge" || { no "⑩p rc=$rc"; printf '%s\n' "$out" | head -2; }
printf '99990018 node /opt/x/channel-server/dist/server.js grep\n' > "$T/ps.txt"
out="$(cw k7 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ok "⑩q sec ⑪ r2: «… dist/server.js grep» → still a bridge (the word grep does not hide it)" || { no "⑩q rc=$rc"; printf '%s\n' "$out" | head -2; }
printf '99990019 node /evil/channel-server/dist/server.js --x %s/app/channel-server\n' "$sm_root" > "$T/ps.txt"
out="$(cw k8 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ok "⑩r sec ⑪ r2: a foreign server.js with OUR install path as an argument → still a bridge" || { no "⑩r rc=$rc"; printf '%s\n' "$out" | head -2; }
# negative controls (must not regress): a genuine no-argument relay is still a relay — absolute (⑩h above) and relative
printf '99990015 node dist/mcp.js\n' > "$T/ps.txt"
out="$(cw k4 Linux)"; rc=$?
if [ $rc -ne 1 ] && ! printf '%s' "$out" | grep -q '다리 [0-9]*개' && printf '%s' "$out" | grep -q '중계 부품(mcp.js) 1개'; then ok "⑩n sec ⑪ control: relative no-argument «node dist/mcp.js» in a channel-server folder → still a relay (rc $rc)"; else no "⑩n rc=$rc"; printf '%s\n' "$out" | head -3; fi
# sec ⑪ round 3 (security review 10-26): only EXACT shapes — a relay = «<node> …/dist/mcp.js» (two words: how mcp.json and
# «npm run mcp» start it · all 17 relays seen on the build Mac 10-26) · ours = «<node> $ROOT/app/channel-server/dist/{server,mcp}.js».
# Node flags before the script, a wrapper, «node -e», extra words = a bridge. A process that calls itself grep is NOT skipped
# (argv[0] can be set — on macOS «ps comm» shows that name too).
printf '99990016 node --enable-source-maps /home/u/.claude/plugins/claude-channel-server/dist/mcp.js\n' > "$T/ps.txt"
out="$(cw k5 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩o r3: node flags BEFORE the script → a bridge (exact shape only · was a relay in round 1-2)" || { no "⑩o rc=$rc"; printf '%s\n' "$out" | head -3; }
printf '99990020 grep /outside/claude-channel-server/dist/server.js\n' > "$T/ps.txt"
out="$(cw k9 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ok "⑩s r3: a process named grep whose line names the bridge → counted (the name can be forged)" || { no "⑩s rc=$rc"; printf '%s\n' "$out" | head -2; }
printf '99990021 /bin/sh /tmp/wrap.sh /outside/claude-channel-server/dist/mcp.js\n' > "$T/ps.txt"
out="$(cw k10 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩t r3: a wrapper script + trailing …/dist/mcp.js → a bridge, not a relay" || { no "⑩t rc=$rc"; printf '%s\n' "$out" | head -2; }
printf '99990022 node -e require(/outside/channel-server/dist/server.js) /outside/claude-channel-server/dist/mcp.js\n' > "$T/ps.txt"
out="$(cw k11 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ! printf '%s' "$out" | grep -q '중계 부품' && ok "⑩u r3: «node -e require(…server.js) …/dist/mcp.js» → a bridge, not a relay" || { no "⑩u rc=$rc"; printf '%s\n' "$out" | head -2; }
printf '99990015 /srv/claude-channel-server\n99990023 /srv/claude-channel-server\n' > "$T/cwd.txt"
printf '99990023 node dist/server.js %s/app/channel-server\n' "$sm_root" > "$T/ps.txt"
out="$(cw k12 Linux)"; rc=$?
[ $rc -eq 1 ] && printf '%s' "$out" | grep -q '다리 1개' && ok "⑩v r3: relative «node dist/server.js» in a channel-server folder + a word naming OUR app folder → a bridge (not ours)" || { no "⑩v rc=$rc"; printf '%s\n' "$out" | head -2; }
printf '99990024 /opt/homebrew/bin/node %s/app/channel-server/dist/mcp.js\n99990025 node %s/app/channel-server/dist/server.js\n' "$sm_root" "$sm_root" > "$T/ps.txt"
out="$(cw k13 Linux)"; rc=$?
if [ $rc -ne 1 ] && ! printf '%s' "$out" | grep -q '다리 [0-9]*개' && ! printf '%s' "$out" | grep -q '중계 부품'; then ok "⑩w r3 control: our own exact relay + bridge (absolute node path) → not counted (rc $rc)"; else no "⑩w rc=$rc"; printf '%s\n' "$out" | head -3; fi

finish
