#!/usr/bin/env bash
# m1-plan-py.sh — setup/lib/plan.py: every setup.json column has one positive and one negative case; secrets are refused
# without being printed; the CLI contract (rc 0 usable / 2 not · --normalize · --out) holds; defaults make a short answers file work.
#   bash setup/tests/m1-plan-py.sh [path/to/plan.py]        rc 0 = all PASS
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib.sh"
PLAN="${1:-$SETUP_DIR/lib/plan.py}"
T="$(mk_tmp m1-planpy)"
trap 'rm -rf "$T"' EXIT
python3 -I - "$PLAN" "$T" <<'PY'
import copy, importlib.util, json, os, subprocess, sys
sys.dont_write_bytecode = True
plan_path, tmp = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location('plan_under_test', plan_path)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
HOME = os.path.normpath(tmp + '/home')   # (TMPDIR may end in «/» — plan.py normalizes the paths it prints)
fail = 0
def ok(t): print('PASS ' + t)
def no(t):
    global fail
    print('FAIL ' + t); fail = 1

BASE = {'schema': 1, 'mode': 'full', 'mux': 'tmux',
        'slack': {'enabled': True, 'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01', 'guests': ['UGUESTAAA01']},
        'wiki': {'path': HOME + '/wiki'}, 'mcp': ['wiki-search'], 'codex': True, 'doctor': True, 'browser': 'aside', 'memory': 'hindsight',
        'bots': [{'name': 'lead', 'role': 'lead', 'work_dir': HOME + '/bots/lead', 'source': 'role-default', 'persona_dir': HOME + '/bots/lead'},
                 {'name': 'watch-2', 'role': 'watch', 'work_dir': HOME + '/bots/watch-2', 'source': 'import', 'persona_dir': HOME + '/bots/watch-2',
                  'slack_bot_user_id': 'UTESTBOT002', 'model': 'sonnet'}],
        'import': {'from': ['claude-md:global', 'agent:reviewer'], 'to': HOME + '/.slackmod/import/20261024-170000'},
        # 11-02 (stage 1): an outside memory (hindsight) is saved only with a passed connection test (m4-plan2 ② covers the refusal)
        'memory_setup': {'starter': False, 'starter_path': None, 'external_probe': 'ok'}}
def probs(st):
    return m.check(st, HOME)
got = probs(BASE)
(ok if got == [] else no)('0 BASE setup (every column filled) → no problems (got %s)' % got)

def case(label, mut, want):
    """want = None → must pass · else the problem lines must name `want` (a «where» prefix) and nothing else"""
    st = copy.deepcopy(BASE); mut(st); got = probs(st)
    if want is None:
        (ok if got == [] else no)('%s → passes (got %s)' % (label, got))
    else:
        hit = [x for x in got if x.startswith(want)]
        (ok if len(hit) >= 1 and len(got) == len(hit) else no)('%s → refused, names %s (got %s)' % (label, want, got))
def setk(path, v):
    def f(st):
        d = st
        for k in path[:-1]: d = d[k]
        if v is DEL: d.pop(path[-1], None)
        else: d[path[-1]] = v
    return f
DEL = object()

# schema · mode · mux · browser · memory (enumerations: each value positive, one stranger negative)
case('schema 2', setk(['schema'], 2), 'setup.schema')
case('schema missing', setk(['schema'], DEL), 'setup.schema')
for v in m.MODES: case('mode ' + v, (lambda v: lambda st: (st.__setitem__('mode', v), st.__setitem__('bots', st['bots'] if v != 'blank' else [])))(v), None)
case('mode turbo', setk(['mode'], 'turbo'), 'setup.mode')
for v in m.MUX: case('mux ' + v, setk(['mux'], v), None)
case('mux screen', setk(['mux'], 'screen'), 'setup.mux')
for v in m.BROWSERS: case('browser ' + v, setk(['browser'], v), None)
case('browser lynx', setk(['browser'], 'lynx'), 'setup.browser')
for v in m.MEMORIES: case('memory ' + v, setk(['memory'], v), None)
case('memory elephant', setk(['memory'], 'elephant'), 'setup.memory')
# booleans
for k in ('codex', 'doctor', 'children'):
    case(k + ' false', setk([k], False), None)
    case(k + ' "yes"', setk([k], 'yes'), 'setup.' + k)
# router («하위 라우터(판정 모델이 고름)»): off · shadow · on — shadow / on need a judge («bundled» or command words)
case('router off', setk(['router'], {'mode': 'off'}), None)
case('router on + bundled', setk(['router'], {'mode': 'on', 'judge': 'bundled'}), None)
case('router shadow + command', setk(['router'], {'mode': 'shadow', 'judge': ['python3', '-I', '/opt/judge.py']}), None)
case('router on without a judge', setk(['router'], {'mode': 'on'}), 'setup.router.judge')
case('router mode «record»', setk(['router'], {'mode': 'record', 'judge': 'bundled'}), 'setup.router.mode')
case('router judge starts with an option', setk(['router'], {'mode': 'on', 'judge': ['-c', 'x']}), 'setup.router.judge')
case('router judge word with a line break', setk(['router'], {'mode': 'on', 'judge': ['/opt/j', 'a\nb']}), 'setup.router.judge')
case('router judge 17 words', setk(['router'], {'mode': 'on', 'judge': ['/opt/j'] + ['x'] * 16}), 'setup.router.judge')
case('router not an object', setk(['router'], 'on'), 'setup.router')
case('router unknown key', setk(['router'], {'mode': 'off', 'model': 'haiku'}), 'setup.router.model')
case('router judge word shaped like a key', setk(['router'], {'mode': 'on', 'judge': ['/opt/j', 'sk-' + 'ant-BAITBAITBAITBAIT01']}), 'setup.router.judge')
# children_open («하위 세션이 맡았어요» 자리 · 여는 말): one line · 1~80 characters · no control character · no «» · not token-shaped · absent = default
DEFAULT_OPEN = '하위 세션이 맡았어요'
case('children_open custom', setk(['children_open'], '스레드를 따로 열어 맡겼어요'), None)
case('children_open default text', setk(['children_open'], DEFAULT_OPEN), None)
case('children_open 1 character', setk(['children_open'], '맡'), None)
case('children_open 80 characters', setk(['children_open'], '가' * 80), None)
case('children_open with a custom text and children false', lambda st: (st.__setitem__('children', False), st.__setitem__('children_open', '새 여는 말')), None)
case('children_open with a comma · colon · quote', setk(['children_open'], 'ok, "일" 맡음: 1/2'), None)
def neg_open(label, mut, want):
    """like case(), but the refusal must be the column's OWN rule: the unknown-key line would pass for the wrong reason before the column exists"""
    st = copy.deepcopy(BASE); mut(st); got = probs(st)
    hit = [x for x in got if x.startswith(want) and '모르는 칸' not in x]
    (ok if len(hit) >= 1 and len(got) == len(hit) else no)('%s → refused by its own rule, names %s (got %s)' % (label, want, got))
neg_open('children_open 81 characters', setk(['children_open'], '가' * 81), 'setup.children_open')
neg_open('children_open empty', setk(['children_open'], ''), 'setup.children_open')
neg_open('children_open only spaces', setk(['children_open'], '   '), 'setup.children_open')
neg_open('children_open with a line break', setk(['children_open'], '한 줄\n두 줄'), 'setup.children_open')
neg_open('children_open trailing line break', setk(['children_open'], '맡았어요\n'), 'setup.children_open')
neg_open('children_open with CR', setk(['children_open'], '맡았어요\r'), 'setup.children_open')
neg_open('children_open with a tab', setk(['children_open'], '맡았어요\t'), 'setup.children_open')
neg_open('children_open with NUL', setk(['children_open'], '맡았\x00어요'), 'setup.children_open')
neg_open('children_open with ESC', setk(['children_open'], '맡았\x1b[31m어요'), 'setup.children_open')
neg_open('children_open with U+2028', setk(['children_open'], '맡았\u2028어요'), 'setup.children_open')
neg_open('children_open with «', setk(['children_open'], '맡았\u00ab어요'), 'setup.children_open')
neg_open('children_open with »', setk(['children_open'], '맡았\u00bb어요'), 'setup.children_open')
neg_open('children_open shaped like a Slack token', setk(['children_open'], 'xox' + 'b-BAITBAITBAITBAIT01'), 'setup.children_open')
neg_open('children_open shaped like an API key', setk(['children_open'], 'sk-' + 'ant-BAITBAITBAITBAIT01'), 'setup.children_open')
for bad_v in (123, True, None, ['맡았어요'], {'a': 1}):
    neg_open('children_open non-string %r' % (bad_v,), setk(['children_open'], bad_v), 'setup.children_open')
# mcp
case('mcp empty', setk(['mcp'], []), None)
case('mcp bad name', setk(['mcp'], ['Wiki Search']), 'setup.mcp')
case('mcp 9 entries', setk(['mcp'], ['a%d' % i for i in range(9)]), 'setup.mcp')
# wiki
case('wiki.path null', setk(['wiki', 'path'], None), None)
case('wiki.path ~/wiki', setk(['wiki', 'path'], '~/wiki'), None)
case('wiki.path relative', setk(['wiki', 'path'], 'wiki/notes'), 'setup.wiki.path')
case('wiki.path with a quote', setk(['wiki', 'path'], HOME + "/it's"), 'setup.wiki.path')
case('wiki unknown key', setk(['wiki', 'extra'], 1), 'setup.wiki.extra')
# slack
case('slack.enabled false + empty ids', lambda st: st['slack'].update({'enabled': False, 'channel_id': '', 'owner_user_id': '', 'guests': []}), None)
case('slack.enabled true + empty channel', setk(['slack', 'channel_id'], ''), 'setup.slack.channel_id')
case('slack.channel_id lowercase', setk(['slack', 'channel_id'], 'c0testchan1'), 'setup.slack.channel_id')
case('slack.channel_id trailing LF', setk(['slack', 'channel_id'], 'CTESTCHAN01\n'), 'setup.slack.channel_id')
case('slack.owner_user_id wrong shape', setk(['slack', 'owner_user_id'], 'X123'), 'setup.slack.owner_user_id')
case('slack.owner_user_id W-id', setk(['slack', 'owner_user_id'], 'WTESTUSER01'), None)
case('slack.guests empty', setk(['slack', 'guests'], []), None)
case('slack.guests two', setk(['slack', 'guests'], ['UGUESTAAA01', 'UGUESTBBB02']), None)
case('slack.guests bad id', setk(['slack', 'guests'], ['guest1']), 'setup.slack.guests')
case('slack.guests repeated', setk(['slack', 'guests'], ['UGUESTAAA01', 'UGUESTAAA01']), 'setup.slack.guests')
case('slack.guests holds the owner', setk(['slack', 'guests'], ['UTESTUSER01']), 'setup.slack.guests')
case('slack unknown key', setk(['slack', 'workspace'], 'x'), 'setup.slack.workspace')
# bots
case('bot name 1 char', setk(['bots', 0, 'name'], 'a'), None)
case('bot name 32 chars', setk(['bots', 0, 'name'], 'a' * 32), None)
case('bot name 33 chars', setk(['bots', 0, 'name'], 'a' * 33), 'setup.bots[0].name')
case('bot name upper case', setk(['bots', 0, 'name'], 'Lead'), 'setup.bots[0].name')
case('bot name leading digit', setk(['bots', 0, 'name'], '1lead'), 'setup.bots[0].name')
case('bot name underscore', setk(['bots', 0, 'name'], 'le_ad'), 'setup.bots[0].name')
case('bot name trailing LF', setk(['bots', 0, 'name'], 'lead\n'), 'setup.bots[0].name')
case('bot name reserved', setk(['bots', 0, 'name'], 'slackmod'), 'setup.bots[0].name')
case('bot name used twice', setk(['bots', 1, 'name'], 'lead'), 'setup.bots[1].name')
case('bot -stop clash', lambda st: (st['bots'][0].__setitem__('name', 'lead'), st['bots'][1].__setitem__('name', 'lead-stop'),
                                      st['bots'][1].__setitem__('work_dir', HOME + '/bots/ls'), st['bots'][1].__setitem__('persona_dir', HOME + '/bots/ls')), 'setup.bots:')
case('bot role bad', setk(['bots', 0, 'role'], 'Lead Bot'), 'setup.bots[0].role')
case('bot source blank', setk(['bots', 0, 'source'], 'blank'), None)
case('bot source stolen', setk(['bots', 0, 'source'], 'stolen'), 'setup.bots[0].source')
case('bot work_dir relative', setk(['bots', 0, 'work_dir'], 'bots/lead'), 'setup.bots[0].work_dir')
case('bot work_dir has ..', setk(['bots', 0, 'work_dir'], HOME + '/../etc'), 'setup.bots[0].work_dir')
case('bot work_dir has $', setk(['bots', 0, 'work_dir'], HOME + '/$HOME'), 'setup.bots[0].work_dir')
case('bot work_dir shared', setk(['bots', 1, 'work_dir'], HOME + '/bots/lead'), 'setup.bots[1].work_dir')
case('bot persona_dir relative', setk(['bots', 0, 'persona_dir'], 'p'), 'setup.bots[0].persona_dir')
case('bot slack_bot_user_id empty', setk(['bots', 1, 'slack_bot_user_id'], ''), None)
case('bot slack_bot_user_id bad', setk(['bots', 1, 'slack_bot_user_id'], 'bot'), 'setup.bots[1].slack_bot_user_id')
case('bot slack_bot_user_id = owner', setk(['bots', 1, 'slack_bot_user_id'], 'UTESTUSER01'), 'setup.bots[1].slack_bot_user_id')
case('bot model bad', setk(['bots', 1, 'model'], 'son net'), 'setup.bots[1].model')
case('bot unknown key', setk(['bots', 0, 'color'], 'red'), 'setup.bots[0].color')
case('5 bots', lambda st: st.__setitem__('bots', [{'name': 'b%d' % i, 'work_dir': HOME + '/bots/b%d' % i} for i in range(5)]), 'setup.bots:')
case('4 bots', lambda st: st.__setitem__('bots', [{'name': 'b%d' % i, 'work_dir': HOME + '/bots/b%d' % i} for i in range(4)]), None)
case('bots empty list (not blank)', setk(['bots'], []), 'setup.bots:')
case('bots column missing (role defaults)', setk(['bots'], DEL), None)
case('blank with a bot', setk(['mode'], 'blank'), 'setup.bots:')
case('blank with no bots', lambda st: (st.__setitem__('mode', 'blank'), st.__setitem__('bots', [])), None)
# import
case('import.from empty', setk(['import', 'from'], []), None)
case('import.from bad item', setk(['import', 'from'], ['../../etc/passwd']), 'setup.import.from')
case('import.to null', setk(['import', 'to'], None), None)
case('import.to relative', setk(['import', 'to'], 'copies'), 'setup.import.to')
# secrets: a secret-named column anywhere · a token-shaped value anywhere — refused, and the value never printed
BAITS = [('xoxb-' + '1' * 12 + '-' + 'B' * 20), ('xapp-' + '1-' + 'A' * 24), ('sk-' + 'Q' * 24), ('ghp_' + 'Z' * 24), ('AKIA' + 'Q' * 16)]
for b in BAITS:
    for where, put in (('wiki.path', lambda st, b=b: st['wiki'].__setitem__('path', HOME + '/' + b)),
                       ('bots[0].role', lambda st, b=b: st['bots'][0].__setitem__('role', b)),
                       ('import.from', lambda st, b=b: st['import'].__setitem__('from', ['x:' + b]))):
        st = copy.deepcopy(BASE); put(st, ); got = probs(st)
        leaked = any(b in line for line in got)
        (ok if got and not leaked and any('secret' in x for x in got) else no)('secret-shaped value %s… in %s → refused · not echoed' % (b[:5], where))
for key in ('token', 'bot_token', 'SLACK_APP_TOKEN', 'password', 'api_key', 'client_secret', 'credentials', 'auth'):
    st = copy.deepcopy(BASE); st['slack'][key] = 'x'; got = probs(st)
    (ok if any(('setup.slack.' + key) in x and '비밀값' in x for x in got) else no)('secret column slack.%s → refused (got %d problem lines)' % (key, len(got)))
st = copy.deepcopy(BASE); st[BAITS[0]] = 1; got = probs(st)   # a secret used as a KEY name: the place is named by the (non-secret) path only if the name is safe — must not echo it
(ok if got and not any(BAITS[0] in x for x in got) else no)('token-shaped KEY name → refused · not echoed')
case('top-level unknown key', setk(['telemetry'], True), 'setup.telemetry')

# --- CLI contract ---
def cli(*args, st=None, name='s.json'):
    p = tmp + '/' + name
    if st is not None: json.dump(st, open(p, 'w'), ensure_ascii=False)
    return subprocess.run([sys.executable, '-I', plan_path, p if st is not None else args[0]] + list(args[(0 if st is not None else 1):]), capture_output=True, text=True)
r = cli('--home', HOME, st=BASE)
(ok if r.returncode == 0 and r.stdout.startswith('OK ') else no)('CLI usable file → rc %d · «%s»' % (r.returncode, r.stdout.strip()))
bad = copy.deepcopy(BASE); bad['bots'][0]['name'] = 'Bad'
r = cli('--home', HOME, st=bad)
(ok if r.returncode == 2 and 'bots[0].name' in r.stdout else no)('CLI bad file → rc %d · names the field' % r.returncode)
r = subprocess.run([sys.executable, '-I', plan_path, tmp + '/missing.json'], capture_output=True, text=True)
(ok if r.returncode == 2 else no)('CLI missing file → rc %d' % r.returncode)
open(tmp + '/broken.json', 'w').write('{"schema": 1,')
r = subprocess.run([sys.executable, '-I', plan_path, tmp + '/broken.json'], capture_output=True, text=True)
(ok if r.returncode == 2 and 'JSON' in r.stdout else no)('CLI broken JSON → rc %d · says JSON' % r.returncode)
r1 = cli('--normalize', '--home', HOME, st=BASE); r2 = cli('--normalize', '--home', HOME, st=BASE)
(ok if r1.returncode == 0 and r1.stdout == r2.stdout and json.loads(r1.stdout)['schema'] == 1 else no)('CLI --normalize twice → same bytes')
# a short answers file: defaults fill in (role-default trio · tmux not pinned · playwright · memory later · doctor on)
short = {'schema': 1, 'slack': {'channel_id': 'CTESTCHAN01', 'owner_user_id': 'UTESTUSER01'}}
r = cli('--normalize', '--home', HOME, st=short, name='short.json')
n = json.loads(r.stdout) if r.returncode == 0 else {}
want_bots = ['lead', 'watch', 'research']
(ok if r.returncode == 0 and [b['name'] for b in n['bots']] == want_bots and n['mode'] == 'quick' and n['mux'] == 'auto' and n['browser'] == 'playwright'
       and n['memory'] == 'later' and n['doctor'] is True and n['codex'] is False and n['children'] is True and n['slack']['enabled'] is True
       and n['bots'][0]['work_dir'] == HOME + '/bots/lead' and n['bots'][0]['persona_dir'] == HOME + '/bots/lead' and n['bots'][0]['source'] == 'role-default'
   else no)('short answers file → defaults: quick · trio %s · mux auto · playwright · memory later · doctor on · children on · ~/bots/<name>' % want_bots)
(ok if r.returncode == 0 and n.get('router') == {'mode': 'off', 'judge': None} else no)('short answers file → router off, no judge (got %s)' % n.get('router'))
(ok if r.returncode == 0 and n.get('children_open') == DEFAULT_OPEN else no)('short answers file → --normalize fills children_open with the default «%s» (got %r)' % (DEFAULT_OPEN, n.get('children_open')))
(ok if r.returncode == 0 and 'children_open' in n and list(n).index('children_open') == list(n).index('children') + 1 else no)('--normalize writes children_open right after children')
cust = copy.deepcopy(BASE); cust['children_open'] = '스레드를 따로 열어 맡겼어요'
rc_ = cli('--normalize', '--home', HOME, st=cust, name='cust.json'); nc = json.loads(rc_.stdout) if rc_.returncode == 0 else {}
(ok if rc_.returncode == 0 and nc.get('children_open') == '스레드를 따로 열어 맡겼어요' else no)('--normalize keeps a custom children_open as typed (got %r)' % nc.get('children_open'))
(ok if rc_.returncode == 0 and probs(nc) == [] and m.normalize(nc, HOME) == nc else no)('normalized file with a custom children_open re-checks clean · idempotent')
nl = copy.deepcopy(BASE); nl['children_open'] = '한 줄\n두 줄'
rn = cli('--home', HOME, st=nl, name='nl.json')
(ok if rn.returncode == 2 and 'children_open' in rn.stdout else no)('CLI children_open with a line break → rc %d · names children_open' % rn.returncode)
tk = copy.deepcopy(BASE); tk['children_open'] = 'xox' + 'b-BAITBAITBAITBAIT01'
rt_ = cli('--home', HOME, st=tk, name='tk.json')
(ok if rt_.returncode == 2 and 'children_open' in rt_.stdout and 'BAITBAIT' not in rt_.stdout else no)('CLI token-shaped children_open → rc %d · named · bait not printed' % rt_.returncode)
short2 = {'schema': 1, 'bots': [{'name': 'solo'}]}
r = cli('--normalize', '--home', HOME, st=short2, name='short2.json')
n = json.loads(r.stdout) if r.returncode == 0 else {}
(ok if r.returncode == 0 and n['slack']['enabled'] is False and n['bots'][0]['role'] == 'custom' and n['bots'][0]['source'] == 'blank' else no)('short file without slack → Slack «나중에» (enabled false) · bot role custom · source blank')
# ~ is made absolute under --home
tilde = copy.deepcopy(BASE); tilde['wiki']['path'] = '~/wiki'; tilde['bots'][0]['work_dir'] = '~/bots/x'; tilde['bots'][0]['persona_dir'] = '~/bots/x'
r = cli('--normalize', '--home', HOME, st=tilde, name='tilde.json')
n = json.loads(r.stdout) if r.returncode == 0 else {}
(ok if r.returncode == 0 and n['wiki']['path'] == HOME + '/wiki' and n['bots'][0]['work_dir'] == HOME + '/bots/x' else no)('«~/» paths become absolute under --home')
# --out: writes the normalized file (0644), replaces in one step, prints OK
outp = tmp + '/out/dir/setup.json'
r = cli('--out', outp, '--home', HOME, st=BASE, name='o.json')
mode = oct(os.stat(outp).st_mode & 0o777) if os.path.exists(outp) else None
(ok if r.returncode == 0 and mode == '0o644' and json.load(open(outp))['bots'][0]['name'] == 'lead' and not [f for f in os.listdir(os.path.dirname(outp)) if '.tmp-' in f] else no)('CLI --out → written %s · no temp file left' % mode)
bad_out = tmp + '/out/bad.json'
r = cli('--out', bad_out, '--home', HOME, st=bad, name='b2.json')
(ok if r.returncode == 2 and not os.path.exists(bad_out) else no)('CLI --out with a bad file → rc 2 · nothing written')
# the normalized result of the full BASE has no secrets and re-checks clean (idempotent)
norm = json.loads(cli('--normalize', '--home', HOME, st=BASE).stdout)
(ok if probs(norm) == [] and m.normalize(norm, HOME) == norm else no)('normalize(normalize(x)) == normalize(x) and passes check()')
print('rc=%d' % fail)
sys.exit(fail)
PY
exit $?
